import { cleanEmail, validEmail, newId } from './helpers.js';
import { validPassword } from './publication-utils.js';

/** Solo el último administrador activo está protegido contra desactivación. */
export function wouldDisableLastAdmin(current, nextActive, activeAdminCount) {
  return current?.role === 'admin' && current.is_active === true &&
    nextActive === false && Number(activeAdminCount) <= 1;
}

/** Se inyecta el hasher para probar la ruta sin tocar PostgreSQL ni credenciales. */
export function registerAdminUserRoutes(app, { auth, adminOnly, pool, hashPassword }) {
  app.post('/api/users/admin', auth, adminOnly, async (req, res, next) => {
    try {
      const email = cleanEmail(req.body?.email);
      const password = req.body?.password;
      if (!validEmail(email) || !validPassword(password)) {
        return res.status(400).json({ error: 'Correo inválido o contraseña fuera del rango de 12 a 128 caracteres' });
      }
      const hash = await hashPassword(password);
      const id = newId();
      await pool.query(
        'INSERT INTO users(id,email,password_hash,role,client_id) VALUES($1,$2,$3,$4,NULL)',
        [id, email, hash, 'admin']
      );
      res.status(201).json({ user: { id, email, role: 'admin', clientId: null, isActive: true } });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Ese correo ya está registrado' });
      next(e);
    }
  });
}
