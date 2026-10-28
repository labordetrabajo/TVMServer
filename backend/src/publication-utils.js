/** Utilidades puras para autorizar una o varias pantallas sin cruzar clientes. */
export function normalizeTotemIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new Error('Seleccioná entre 1 y 100 tótems');
  if (value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw new Error('Hay un identificador de tótem inválido');
  if (new Set(value).size !== value.length) throw new Error('No se permiten tótems duplicados');
  return value;
}
export function parseMultipartTotemIds(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Seleccioná los tótems');
  let ids;try { ids = JSON.parse(value); } catch { throw new Error('Lista de tótems inválida'); }
  return normalizeTotemIds(ids);
}
export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}
