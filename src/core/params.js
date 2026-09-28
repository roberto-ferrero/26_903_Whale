/**
 * Registro de parámetros por módulo (Fase 2.2): presets en JSON y estado en la URL.
 *
 * Cada módulo registra un objeto de estado plano (números, booleanos, textos y colores `#rrggbb`)
 * y una función `apply()` que lleva ese estado a la escena. Con eso se puede:
 *  - guardar/cargar presets (`{ nombre, descripcion, valores: { modulo: { clave: valor } } }`),
 *  - escribir en la URL solo lo que difiere de los valores por defecto (`#salto.exitSpeed=8&luz.exposure=1.2`),
 *  - restablecer todo.
 */
export function createParamRegistry() {
  const modules = new Map();
  const listeners = [];

  const isPlain = (v) => ['number', 'boolean', 'string'].includes(typeof v);

  function add(name, state, apply = () => {}, keys = null) {
    const k = (keys ?? Object.keys(state)).filter((key) => isPlain(state[key]));
    modules.set(name, { state, apply, keys: k, defaults: Object.fromEntries(k.map((key) => [key, state[key]])) });
  }

  /** Valores actuales; con `onlyChanged`, solo los que difieren del valor por defecto. */
  function snapshot(onlyChanged = false) {
    const out = {};
    for (const [name, m] of modules) {
      for (const key of m.keys) {
        const v = m.state[key];
        if (onlyChanged && v === m.defaults[key]) continue;
        (out[name] ??= {})[key] = v;
      }
    }
    return out;
  }

  /** Aplica valores (parciales). Ignora módulos o claves desconocidos y convierte tipos. */
  function applyValues(values, { reset = false } = {}) {
    for (const [name, m] of modules) {
      const vals = values?.[name] ?? {};
      let changed = false;
      for (const key of m.keys) {
        const def = m.defaults[key];
        let v = key in vals ? vals[key] : reset ? def : undefined;
        if (v === undefined) continue;
        if (typeof def === 'number') v = Number(v);
        else if (typeof def === 'boolean') v = v === true || v === 'true' || v === '1';
        else v = String(v);
        if (Number.isNaN(v)) continue;
        if (m.state[key] !== v) { m.state[key] = v; changed = true; }
      }
      if (changed || reset) m.apply();
    }
    listeners.forEach((fn) => fn());
  }

  function toHash() {
    const params = new URLSearchParams();
    for (const [name, vals] of Object.entries(snapshot(true))) {
      for (const [key, v] of Object.entries(vals)) params.set(`${name}.${key}`, typeof v === 'number' ? +v.toFixed(4) : v);
    }
    return params.toString();
  }

  function fromHash(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const values = {};
    for (const [path, v] of params) {
      const [name, key] = path.split('.');
      if (name && key) (values[name] ??= {})[key] = v;
    }
    return values;
  }

  return {
    add,
    snapshot,
    apply: applyValues,
    reset() { applyValues({}, { reset: true }); },
    onChange(fn) { listeners.push(fn); },
    /** Escribe el estado en la URL sin crear entradas de historial. */
    writeURL() {
      const hash = toHash();
      history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
    },
    readURL() {
      if (location.hash.length > 1) applyValues(fromHash(location.hash));
    },
    shareURL() {
      const hash = toHash();
      return `${location.origin}${location.pathname}${location.search}${hash ? `#${hash}` : ''}`;
    },
    /** Preset con los valores actuales (solo lo que difiere de los valores por defecto). */
    toPreset(nombre, descripcion = '') {
      return { nombre, descripcion, valores: snapshot(true) };
    },
  };
}

/** Presets incluidos en el proyecto (`src/presets/*.json`), ordenados por nombre de archivo. */
export function loadBuiltinPresets() {
  const files = import.meta.glob('../presets/*.json', { eager: true, import: 'default' });
  return Object.keys(files).sort().map((path) => files[path]);
}
