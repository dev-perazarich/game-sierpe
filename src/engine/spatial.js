/**
 * spatial.js — Hash espacial uniforme.
 *
 * Se conserva la idea del código original pero con dos cambios que importan:
 *  - clave numérica en lugar de string, para no crear basura en cada inserción
 *  - los buckets se reutilizan entre fotogramas (clear() vacía arrays, no el Map)
 */

export class SpatialHash {
  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.cells = new Map();
    this.used = [];
  }

  _key(cx, cy) {
    // Empaquetado en un entero: soporta coordenadas de celda en [-32768, 32767].
    return ((cx + 32768) << 16) | (cy + 32768);
  }

  insert(x, y, item) {
    const cx = Math.floor(x * this.inv);
    const cy = Math.floor(y * this.inv);
    const key = this._key(cx, cy);
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    if (bucket.length === 0) this.used.push(bucket);
    bucket.push(item);
  }

  /** Vuelca en `out` todo lo que haya en las celdas que toca el círculo dado. */
  query(x, y, radius, out = []) {
    out.length = 0;
    const cx0 = Math.floor((x - radius) * this.inv);
    const cx1 = Math.floor((x + radius) * this.inv);
    const cy0 = Math.floor((y - radius) * this.inv);
    const cy1 = Math.floor((y + radius) * this.inv);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (bucket !== undefined) {
          for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
      }
    }
    return out;
  }

  clear() {
    for (let i = 0; i < this.used.length; i++) this.used[i].length = 0;
    this.used.length = 0;
  }
}
