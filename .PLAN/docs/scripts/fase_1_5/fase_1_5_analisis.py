"""Fase 1.5 · Análisis de texturas (solo lectura).

Uso:
  blender.exe --background --factory-startup --python fase_1_5_analisis.py -- <carpeta textures> <carpeta referencias> <salida.json>

Estadísticas de color (en sRGB 0-1) de la piel y de las referencias, separando
tonos oscuros (dorso) y claros (vientre), y de las rugosidades seca/mojada y el AO.
"""
import bpy
import json
import os
import sys
import numpy as np

TEX, REFS, OUT = sys.argv[sys.argv.index("--") + 1:][:3]


def load(path, linear=False):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"  # leer los valores tal cual (sRGB codificado)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def color_stats(rgb, mask=None):
    px = rgb.reshape(-1, 3) if mask is None else rgb[mask]
    L = lum(px)
    dark = px[L < 0.25]
    light = px[L > 0.6]
    r = lambda v: [round(float(x), 3) for x in v]
    return {"pixels": int(len(px)), "mean": r(px.mean(0)), "dark_share": round(len(dark) / len(px), 3),
            "dark_mean": r(dark.mean(0)) if len(dark) else None,
            "light_share": round(len(light) / len(px), 3), "light_mean": r(light.mean(0)) if len(light) else None,
            "p05_p50_p95_lum": [round(float(np.percentile(L, q)), 3) for q in (5, 50, 95)]}


rep = {}
dif = load(os.path.join(TEX, "skin_diffuse_2k.png"))
ao = load(os.path.join(TEX, "skin_ao_2k.png"))
dry = load(os.path.join(TEX, "skin_roughness_dry_2k.png"))
wet = load(os.path.join(TEX, "skin_roughness_wet_2k.png"))
nrm = load(os.path.join(TEX, "skin_normal_2k.png"))
used = dif[..., 3] > 0.5  # todo el atlas es opaco; se usa para excluir nada
rep["diffuse"] = color_stats(dif[..., :3])
# color efectivo del material original: diffuse * AO (multiply, factor 1) en espacio lineal
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
rep["diffuse_x_ao"] = color_stats(srgb(lin(dif[..., :3]) * ao[..., :1]))
rep["ao"] = {"mean": round(float(ao[..., 0].mean()), 3), "p05": round(float(np.percentile(ao[..., 0], 5)), 3),
             "min": round(float(ao[..., 0].min()), 3)}
rep["rough_dry"] = {"mean": round(float(dry[..., 0].mean()), 3), "p05_p95": [round(float(np.percentile(dry[..., 0], q)), 3) for q in (5, 95)]}
rep["rough_wet"] = {"mean": round(float(wet[..., 0].mean()), 3), "p05_p95": [round(float(np.percentile(wet[..., 0], q)), 3) for q in (5, 95)]}
d = dry[..., 0] - wet[..., 0]
rep["dry_minus_wet"] = {"mean": round(float(d.mean()), 3), "min": round(float(d.min()), 3), "max": round(float(d.max()), 3),
                        "p95": round(float(np.percentile(d, 95)), 3)}
# convención del normal map: media de G (≈0,5 en ambas), se comprueba visualmente en el render
rep["normal_mean_rgb"] = [round(float(nrm[..., i].mean()), 3) for i in range(3)]

rep["refs"] = {}
for f in sorted(os.listdir(REFS)):
    ref = load(os.path.join(REFS, f))[..., :3]
    # quitar fondo claro/azulado: nos quedamos con píxeles poco saturados (piel blanco/negro/gris)
    mx, mn = ref.max(-1), ref.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    mask = (sat < 0.25) & (mx < 0.97)
    rep["refs"][f] = color_stats(ref, mask)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(rep, fh, indent=1)
print(json.dumps(rep, indent=1))
