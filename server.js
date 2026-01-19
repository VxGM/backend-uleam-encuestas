const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt'); // <--- IMPORTANTE: Seguridad

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de la Base de Datos
const pool = new Pool({
  // Esta línea es la más importante:
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para conexiones externas en Render
  },
  user: 'postgres',
  host: 'localhost',
  database: 'univoz_db',
  password: 'postgres',
  port: 5433,
});

// --- RUTA 1: INICIALIZAR USUARIOS (Crea admin y estudiante con claves encriptadas) ---
app.get('/api/crear-usuarios', async (req, res) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const passwordEncriptada = await bcrypt.hash('123456', salt); // La clave será 123456

    // 1. Insertar Admin
    await pool.query(
      "INSERT INTO usuarios (email, password, rol) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      ['admin@live.uleam.edu.ec', passwordEncriptada, 'admin']
    );

    // 2. Insertar Estudiante
    await pool.query(
      "INSERT INTO usuarios (email, password, rol) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      ['juan@live.uleam.edu.ec', passwordEncriptada, 'estudiante']
    );

    res.send("<h1>¡Usuarios creados!</h1><p>Admin: admin@live.uleam.edu.ec / 123456</p><p>Estudiante: juan@live.uleam.edu.ec / 123456</p>");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creando usuarios: " + err.message);
  }
});

// --- RUTA 2: LOGIN SEGURO (Verifica contraseña real) ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const usuario = userResult.rows[0];
    const esCorrecta = await bcrypt.compare(password, usuario.password);

    if (!esCorrecta) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    res.json({ status: 'success', email: usuario.email, rol: usuario.rol });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// --- RUTA 3: PENDIENTES DEL DASHBOARD ---
app.get('/api/pendientes', async (req, res) => {
  const { email } = req.query;
  try {
    const voto = await pool.query('SELECT * FROM votos WHERE email = $1', [email]);
    const opinionCafe = await pool.query("SELECT * FROM opiniones WHERE email = $1 AND categoria = 'cafeteria'", [email]);
    const opinionLabs = await pool.query("SELECT * FROM opiniones WHERE email = $1 AND categoria = 'laboratorios'", [email]);

    const yaVotoElecciones = voto.rows.length > 0;
    const yaVotoCafe = opinionCafe.rows.length > 0;
    const yaVotoLabs = opinionLabs.rows.length > 0;

    let pendientes = 0;
    if (!yaVotoElecciones) pendientes++;

    res.json({
      pendientes: pendientes,
      estado: {
        elecciones: yaVotoElecciones,
        cafeteria: yaVotoCafe,
        laboratorios: yaVotoLabs
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// --- RUTA 4: REGISTRAR VOTO (ELECCIONES) ---
app.post('/api/votar', async (req, res) => {
  const { email, candidato, propuestas, comentarios } = req.body;
  try {
    const verificar = await pool.query('SELECT * FROM votos WHERE email = $1', [email]);
    if (verificar.rows.length > 0) {
      return res.json({ status: 'error', message: 'Usuario ya votó' });
    }
    await pool.query(
      'INSERT INTO votos (email, candidato, propuestas, comentarios) VALUES ($1, $2, $3, $4)',
      [email, candidato, propuestas, comentarios]
    );
    res.json({ status: 'success', message: 'Voto guardado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al votar' });
  }
});

// --- RUTA 5: REGISTRAR OPINIONES (CAFETERÍA/LABS) ---
app.post('/api/opinion', async (req, res) => {
  const { email, categoria, calificacion, comentario } = req.body;
  try {
    await pool.query(
      'INSERT INTO opiniones (email, categoria, calificacion, comentario) VALUES ($1, $2, $3, $4)',
      [email, categoria, calificacion, comentario]
    );
    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar opinion' });
  }
});

// --- RUTA 6: RESULTADOS PARA ADMIN (GRÁFICO) ---
app.get('/api/resultados', async (req, res) => {
  try {
    const result = await pool.query('SELECT candidato, COUNT(*) as total FROM votos GROUP BY candidato');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo resultados' });
  }
});

// --- RUTA 7: LEER OPINIONES PARA ADMIN ---
app.get('/api/opiniones', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM opiniones ORDER BY fecha DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al leer opiniones' });
  }
});

// --- RUTA 8: REINICIAR SISTEMA (ADMIN) ---
app.delete('/api/reset', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE votos, opiniones RESTART IDENTITY');
    res.json({ status: 'success', message: 'Sistema reiniciado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error crítico al reiniciar' });
  }
});
// --- RUTA 9: GESTIÓN DE USUARIOS (CRUD) ---

// 9.1. LISTAR TODOS LOS USUARIOS
app.get('/api/usuarios', async (req, res) => {
  try {
    // Traemos todos (excepto la contraseña por seguridad visual)
    const result = await pool.query('SELECT id, email, rol FROM usuarios ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// 9.2. CREAR USUARIO NUEVO (Desde el panel)
app.post('/api/usuarios', async (req, res) => {
  const { email, password, rol } = req.body;
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO usuarios (email, password, rol) VALUES ($1, $2, $3)',
      [email, hash, rol]
    );
    res.json({ status: 'success', message: 'Usuario creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear usuario (quizás el correo ya existe)' });
  }
});

// 9.3. ELIMINAR USUARIO
app.delete('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ status: 'success', message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// 9.4. CAMBIAR ROL (Editar simple)
app.put('/api/usuarios/:id/rol', async (req, res) => {
  const { id } = req.params;
  const { nuevoRol } = req.body; // 'admin' o 'estudiante'
  try {
    await pool.query('UPDATE usuarios SET rol = $1 WHERE id = $2', [nuevoRol, id]);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});
// --- RUTA NUEVA: BORRAR SOLO LOS VOTOS (Reiniciar Elecciones) ---
app.delete('/api/votos', async (req, res) => {
  try {
    // TRUNCATE vacía la tabla rápido. RESTART IDENTITY pone el contador de ID en 1 de nuevo.
    await pool.query('TRUNCATE TABLE votos RESTART IDENTITY');
    res.json({ status: 'success', message: 'Votos eliminados correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar votos' });
  }
});
// --- RUTA NUEVA: BORRAR UNA SOLA OPINIÓN (Por ID) ---
app.delete('/api/opiniones/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM opiniones WHERE id = $1', [id]);
    res.json({ status: 'success', message: 'Opinión eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar opinión' });
  }
});

// --- RUTA NUEVA: REINICIAR OPINIONES POR CATEGORÍA (Cafetería o Labs) ---
app.delete('/api/opiniones-reset', async (req, res) => {
  const { categoria } = req.query; // Ejemplo: ?categoria=cafeteria
  try {
    if (!categoria) {
        return res.status(400).json({ error: 'Falta la categoría' });
    }
    await pool.query('DELETE FROM opiniones WHERE categoria = $1', [categoria]);
    res.json({ status: 'success', message: `Se reinició la categoría ${categoria}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al reiniciar categoría' });
  }
});
app.get('/api/crear-usuarios', async (req, res) => {
    try {
        // 1. Crear las tablas con la estructura exacta que solicitaste
        await pool.query(`
            CREATE TABLE IF NOT EXISTS votos (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) NOT NULL,
                candidato VARCHAR(50),
                propuestas TEXT,
                comentarios TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS opiniones (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) NOT NULL,
                categoria VARCHAR(50),
                calificacion INT,
                comentario TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                rol VARCHAR(20) DEFAULT 'estudiante'
            );
        `);

        // 2. Preparar el usuario Administrador para la ULEAM
        const salt = await bcrypt.genSalt(10);
        const passAdmin = await bcrypt.hash('admin123', salt);

        // Limpiar si ya existe para evitar errores de duplicado
        await pool.query("DELETE FROM usuarios WHERE email = 'admin@uleam.edu.ec'");

        // 3. Insertar el admin con el nuevo esquema
        await pool.query(
            "INSERT INTO usuarios (email, password, rol) VALUES ($1, $2, $3)",
            ['admin@uleam.edu.ec', passAdmin, 'admin']
        );

        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h1 style="color: #27ae60;">✅ Estructura Sincronizada</h1>
                <p>Las tablas <b>votos, opiniones y usuarios</b> coinciden con tu esquema local.</p>
                <p>Usuario: <strong>admin@uleam.edu.ec</strong> listo.</p>
                <a href="https://uleam-encuestas.onrender.com" style="color: blue;">Volver al sitio</a>
            </div>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en la sincronización: " + err.message);
    }
});

// Inicio del servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});