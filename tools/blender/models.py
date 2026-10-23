# Hot Air – every model in the game, built in Blender from code (the source of truth). Run it through
# tools/blender/build.py, which writes the assets (see there).
#
# One object per model, its origin on the ground at its centre, the front facing Blender −Y (south in the
# game). Low poly, flat shaded, coloured by materials (the game turns them into vertex colours). Kept cheap:
# the models are merged by the hundred into the terrain chunks. Buildings reach 3 m below their origin
# (a plinth), so they stand on a slope without floating.

import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = ARGS[0] if ARGS else None

# ---------------------------------------------------------------- palette
PALETTE = {
    # walls and roofs
    'brick': '#9a4632', 'brick_dark': '#7f3a2a', 'brick_light': '#b0603f', 'brick_church': '#8c4331',
    'tile_dark': '#3f4046', 'tile_red': '#a84c2c', 'thatch': '#7e6a46', 'thatch_dark': '#665638', 'slate': '#4b5059',
    'copper': '#4f7d6c', 'white': '#f1ede3', 'cream': '#e8dcc2', 'glass': '#2b3845', 'glass_light': '#9fc1cf',
    'door_green': '#2f5a46', 'shutter_green': '#3e6e4c', 'wood_dark': '#4f3a2b', 'wood': '#7a4f2e',
    'wood_light': '#9c6b3e', 'wood_grey': '#6d6258', 'barn_wood': '#5d4130', 'plinth': '#5d5650',
    'stone': '#d4be98', 'stone_dark': '#b39a72', 'stone_light': '#e2d1b0', 'stucco_ochre': '#d6a560',
    'stucco_pink': '#d9a88e', 'terracotta': '#ad5636', 'terracotta_dark': '#8f452c', 'shutter_olive': '#5b6c46',
    'stone_grey': '#8e8a84', 'stone_grey_dark': '#6f6c67', 'chalet_wood': '#7a4a26', 'chalet_dark': '#5e3a1f',
    'flowers': '#d2352b', 'flowers_pink': '#e070a0', 'leaves_box': '#4c7a32', 'concrete': '#b5b2ab',
    'concrete_dark': '#8f8c86', 'gondola': '#d6362c', 'clock': '#f4f1e8', 'gold': '#c9a227',
    # metal
    'steel': '#9aa0a6', 'steel_dark': '#6e747b', 'insulator': '#d9e2ea',
    # trees
    'bark': '#5b4634', 'bark_grey': '#6f675a', 'leaf': '#5b8a3a', 'leaf_dark': '#466f2f', 'leaf_light': '#78a64a',
    'poplar': '#5f8c3c', 'poplar_dark': '#4b7531', 'pine': '#2f5530', 'pine_dark': '#264528', 'cypress': '#2c4a28',
    'cypress_dark': '#223b20', 'olive_leaf': '#94a275', 'olive_dark': '#7c8c60',
    # animals and hay
    'cow_black': '#211f1e', 'cow_white': '#f1eee6', 'cow_brown': '#80522f', 'cow_nose': '#d9a39a', 'horn': '#e6dcc4',
    'bell': '#c9a227', 'hay': '#d8b866', 'hay_dark': '#b8963f',
    # the balloon's basket and crew
    'wicker': '#a87d47', 'wicker_dark': '#86622f', 'leather': '#4a2e1c', 'burner': '#8f959b', 'burner_dark': '#55595e',
    'tank': '#c9ccd0', 'skin_a': '#e0b48c', 'skin_b': '#c98f63', 'skin_c': '#f0c7a0', 'skin_d': '#8d5a3b',
    'coat_blue': '#2f5d8c', 'coat_red': '#c8382c', 'coat_green': '#3f7a3a', 'coat_yellow': '#e0a020',
    'hair_dark': '#3a2a20', 'hair_blond': '#c9a35a', 'cap': '#24313d',
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATS = {}


def material(name):
    if name in MATS:
        return MATS[name]
    h = PALETTE[name].lstrip('#')
    rgb = [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    MATS[name] = m
    return m


# ---------------------------------------------------------------- a model builder
class Model:
    """One object: polygons in bmesh, a material per polygon."""

    def __init__(self, name, seed=1):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.rnd = random.Random(seed)
        self.dims = None

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def poly(self, pts, mat):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        return f

    def quad(self, a, b, c, d, mat):
        return self.poly([a, b, c, d], mat)

    # A box from corner to corner; faces: which of top/bottom to keep.
    def box(self, x0, y0, z0, x1, y1, z1, mat, top=True, bottom=False, mats=None):
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        m = mats or {}
        sides = [((0, 1, 5, 4), 'front'), ((1, 2, 6, 5), 'right'), ((2, 3, 7, 6), 'back'), ((3, 0, 4, 7), 'left')]
        for idx, key in sides:
            self.poly([p[i] for i in idx], m.get(key, mat))
        if top:
            self.poly([p[4], p[5], p[6], p[7]], m.get('top', mat))
        if bottom:
            self.poly([p[3], p[2], p[1], p[0]], m.get('bottom', mat))

    # A box by centre and size, turned by `rot` about Z.
    def boxc(self, cx, cy, cz, sx, sy, sz, mat, rot=0.0, top=True, bottom=True):
        c, s = math.cos(rot), math.sin(rot)
        def P(dx, dy, dz):
            return (cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
             P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)]
        for idx in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.poly([p[i] for i in idx], mat)
        if top:
            self.poly([p[4], p[5], p[6], p[7]], mat)
        if bottom:
            self.poly([p[3], p[2], p[1], p[0]], mat)

    # A stick from a to b with a square section.
    def beam(self, a, b, w, mat):
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        z = d.normalized()
        x = z.cross(Vector((0, 0, 1)))
        if x.length < 1e-3:
            x = Vector((1, 0, 0))
        x.normalize()
        y = z.cross(x)
        h = w / 2
        ring = lambda o: [o + x * h + y * h, o - x * h + y * h, o - x * h - y * h, o + x * h - y * h]
        r0, r1 = ring(a), ring(b)
        for i in range(4):
            j = (i + 1) % 4
            self.poly([r0[i], r0[j], r1[j], r1[i]], mat)

    # A ring of `segs` sides from z0 (radius r0) to z1 (radius r1); rings at the given (z, r) list if `profile`.
    def lathe(self, cx, cy, profile, segs, mat, cap_top=True, cap_bottom=False, rot=0.0, mats=None, sx=1.0, sy=1.0):
        rings = []
        for z, r in profile:
            rings.append([(cx + math.cos(rot + i * 2 * math.pi / segs) * r * sx, cy + math.sin(rot + i * 2 * math.pi / segs) * r * sy, z) for i in range(segs)])
        for k in range(len(rings) - 1):
            m = mats[k] if mats else mat
            for i in range(segs):
                j = (i + 1) % segs
                a, b, c, d = rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]
                if profile[k + 1][1] < 1e-4:
                    self.poly([a, b, c], m)
                elif profile[k][1] < 1e-4:
                    self.poly([a, c, d], m)
                else:
                    self.poly([a, b, c, d], m)
        if cap_top and profile[-1][1] > 1e-4:
            self.poly(list(reversed(rings[-1])), mats[-1] if mats else mat)
        if cap_bottom and profile[0][1] > 1e-4:
            self.poly(rings[0], mats[0] if mats else mat)

    def cyl(self, cx, cy, z0, z1, r0, r1, segs, mat, cap_top=True, cap_bottom=False, rot=0.0):
        self.lathe(cx, cy, [(z0, r0), (z1, r1)], segs, mat, cap_top, cap_bottom, rot)

    # A low-poly blob (an icosahedron), squashed, its vertices nudged for an organic look.
    def blob(self, cx, cy, cz, rx, ry, rz, mat, jitter=0.12, subdiv=1):
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
        for v in tmp.verts:
            k = 1 + (self.rnd.random() - 0.5) * 2 * jitter
            v.co = Vector((cx + v.co.x * rx * k, cy + v.co.y * ry * k, cz + v.co.z * rz * k))
        for f in tmp.faces:
            self.poly([v.co.copy() for v in f.verts], mat)
        tmp.free()

    # A flat panel on a wall: the wall at `plane` along axis 'x' (a wall facing ±Y) or 'y' (facing ±X),
    # `side` +1/−1 the way it faces; u along the wall, z up.
    def panel(self, axis, plane, side, u0, u1, z0, z1, mat, off=0.03):
        if axis == 'x':
            y = plane + side * off
            self.poly([(u0, y, z0), (u1, y, z0), (u1, y, z1), (u0, y, z1)], mat)
        else:
            x = plane + side * off
            self.poly([(x, u0, z0), (x, u1, z0), (x, u1, z1), (x, u0, z1)], mat)

    # A window: a frame and the glass in it, maybe shutters beside it.
    def window(self, axis, plane, side, u, z, w, h, frame='white', glass='glass', shutters=None, arch=False):
        f = 0.09
        self.panel(axis, plane, side, u - w / 2 - f, u + w / 2 + f, z - f, z + h + f, frame, 0.03)
        if arch:
            # a pointed top: one triangle over the glass
            top = z + h
            if axis == 'x':
                y = plane + side * 0.05
                self.poly([(u - w / 2, y, top), (u + w / 2, y, top), (u, y, top + w * 0.55)], glass)
                y2 = plane + side * 0.03
                self.poly([(u - w / 2 - f, y2, top), (u + w / 2 + f, y2, top), (u, y2, top + w * 0.55 + f * 1.5)], frame)
            else:
                x = plane + side * 0.05
                self.poly([(x, u - w / 2, top), (x, u + w / 2, top), (x, u, top + w * 0.55)], glass)
                x2 = plane + side * 0.03
                self.poly([(x2, u - w / 2 - f, top), (x2, u + w / 2 + f, top), (x2, u, top + w * 0.55 + f * 1.5)], frame)
        self.panel(axis, plane, side, u - w / 2, u + w / 2, z, z + h, glass, 0.05)
        if shutters:
            sw = w * 0.5
            self.panel(axis, plane, side, u - w / 2 - f - sw, u - w / 2 - f, z, z + h, shutters, 0.04)
            self.panel(axis, plane, side, u + w / 2 + f, u + w / 2 + f + sw, z, z + h, shutters, 0.04)

    # A gable roof over x0…x1 × y0…y1 from the eaves at z_eave to the ridge at z_ridge, the ridge along
    # `axis` ('x' or 'y'), overhanging by `over`, as two slabs `thick` thick; the gable walls in `wall`.
    def gable(self, x0, y0, x1, y1, z_eave, z_ridge, axis, mat, wall, over=0.4, thick=0.22, gables=True, trim=None):
        if axis == 'y':
            xm = (x0 + x1) / 2
            half = (x1 - x0) / 2
            slope = (z_ridge - z_eave) / half
            for sgn in (-1, 1):
                xe = xm + sgn * (half + over)
                ze = z_eave - over * slope
                top = [(xe, y0 - over, ze), (xe, y1 + over, ze), (xm, y1 + over, z_ridge), (xm, y0 - over, z_ridge)]
                bot = [(x, y, z - thick) for x, y, z in top]
                self.slab(top, bot, mat)
            if gables:
                for y, s in ((y0, -1), (y1, 1)):
                    self.poly([(x0, y, z_eave), (x1, y, z_eave), (xm, y, z_ridge)], wall)
                    if trim:
                        # barge boards: white strips under the roof edge
                        for sgn in (-1, 1):
                            xe = xm + sgn * (half + over)
                            ze = z_eave - over * slope
                            self.beam((xe, y + s * (over - 0.05), ze - thick), (xm, y + s * (over - 0.05), z_ridge - thick), 0.16, trim)
        else:
            ym = (y0 + y1) / 2
            half = (y1 - y0) / 2
            slope = (z_ridge - z_eave) / half
            for sgn in (-1, 1):
                ye = ym + sgn * (half + over)
                ze = z_eave - over * slope
                top = [(x0 - over, ye, ze), (x1 + over, ye, ze), (x1 + over, ym, z_ridge), (x0 - over, ym, z_ridge)]
                bot = [(x, y, z - thick) for x, y, z in top]
                self.slab(top, bot, mat)
            if gables:
                for x, s in ((x0, -1), (x1, 1)):
                    self.poly([(x, y0, z_eave), (x, y1, z_eave), (x, ym, z_ridge)], wall)
                    if trim:
                        for sgn in (-1, 1):
                            ye = ym + sgn * (half + over)
                            ze = z_eave - over * slope
                            self.beam((x + s * (over - 0.05), ye, ze - thick), (x + s * (over - 0.05), ym, z_ridge - thick), 0.16, trim)

    # A quad slab: the top face, the bottom face and the four edges.
    def slab(self, top, bot, mat):
        self.poly(top, mat)
        self.poly(list(reversed(bot)), mat)
        for i in range(4):
            j = (i + 1) % 4
            self.poly([bot[i], bot[j], top[j], top[i]], mat)

    # A hipped roof: the ridge along `axis`, sloping on all four sides.
    def hip(self, x0, y0, x1, y1, z_eave, z_ridge, axis, mat, over=0.5):
        x0, y0, x1, y1 = x0 - over, y0 - over, x1 + over, y1 + over
        drop = over * (z_ridge - z_eave) / (min(x1 - x0, y1 - y0) / 2)
        ze = z_eave - drop
        if axis == 'y':
            xm, inset = (x0 + x1) / 2, (x1 - x0) / 2
            ra, rb = (xm, y0 + inset, z_ridge), (xm, y1 - inset, z_ridge)
            c = [(x0, y0, ze), (x1, y0, ze), (x1, y1, ze), (x0, y1, ze)]
            self.poly([c[0], c[1], ra], mat)
            self.poly([c[1], c[2], rb, ra], mat)
            self.poly([c[2], c[3], rb], mat)
            self.poly([c[3], c[0], ra, rb], mat)
        else:
            ym, inset = (y0 + y1) / 2, (y1 - y0) / 2
            ra, rb = (x0 + inset, ym, z_ridge), (x1 - inset, ym, z_ridge)
            c = [(x0, y0, ze), (x1, y0, ze), (x1, y1, ze), (x0, y1, ze)]
            self.poly([c[0], c[1], rb, ra], mat)
            self.poly([c[1], c[2], rb], mat)
            self.poly([c[2], c[3], ra, rb], mat)
            self.poly([c[3], c[0], ra], mat)
        # the underside, so the eaves aren't see-through from below
        self.poly([(x0, y0, ze), (x0, y1, ze), (x1, y1, ze), (x1, y0, ze)], mat)

    # The walls of a building: x0…x1 × y0…y1 from z0 (below the ground: a plinth on slopes) to z1.
    def walls(self, x0, y0, x1, y1, z1, mat, plinth='plinth', z0=-3.0, base=0.35):
        self.box(x0, y0, z0, x1, y1, base, plinth, top=False)
        self.box(x0, y0, base, x1, y1, z1, mat, top=False)

    # A collision box for the game, in its coordinates (x, z = −Blender y): a footprint with walls up to
    # `wall` and a gable roof to `ridge` along `axis` ('x' or 'y' in Blender terms).
    def part(self, x0, y0, x1, y1, wall, ridge=None, axis='x'):
        self.dims = self.dims or {}
        parts = self.dims.setdefault('parts', [])
        parts.append({'x0': round(x0, 2), 'x1': round(x1, 2), 'z0': round(-y1, 2), 'z1': round(-y0, 2),
                      'wall': round(wall, 2), 'ridge': round(ridge if ridge is not None else wall, 2),
                      'axis': 'x' if axis == 'x' else 'z'})

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


MODELS = []
# contact sheets for build.py: (name prefixes, file name)
PREVIEWS = [(('tree_',), 'trees'), (('nl_',), 'netherlands'), (('it_', 'hay'), 'italy'), (('ch_',), 'switzerland'),
            (('cow', 'pylon'), 'misc'), (('basket',), 'basket'), (('nl_mill_sails', 'ch_gondola'), 'parts')]


def model(fn):
    MODELS.append(fn)
    return fn


# ================================================================ trees
# Each tree's native size is in its dims (h: height, r: crown radius); the game scales it to the terrain's tree.

@model
def tree_round():
    m = Model('tree_round', 11)
    # a trunk that forks under the crown
    m.cyl(0, 0, -0.5, 3.4, 0.36, 0.25, 5, 'bark', cap_top=False)
    m.beam((0, 0, 3.0), (1.0, 0.3, 4.8), 0.24, 'bark')
    # the crown: a broad clump and two smaller ones, the sunlit one lighter
    m.blob(0, 0, 6.1, 3.1, 3.0, 2.4, 'leaf', 0.1)
    m.blob(1.3, 0.6, 7.6, 2.0, 2.0, 1.7, 'leaf_light', 0.12)
    m.blob(-1.4, -0.6, 6.9, 1.9, 1.9, 1.6, 'leaf_dark', 0.12)
    m.dims = {'h': 10, 'r': 3.4}
    return m


@model
def tree_round_low():
    m = Model('tree_round_low', 12)
    m.blob(0, 0, 6.4, 3.2, 3.1, 3.2, 'leaf', 0.15)
    m.dims = {'h': 10, 'r': 3.4}
    return m


@model
def tree_poplar():
    m = Model('tree_poplar', 13)
    m.cyl(0, 0, -0.5, 2.6, 0.26, 0.2, 5, 'bark_grey', cap_top=False)
    # a tall column of foliage, narrowing to the top
    m.blob(0, 0, 6.6, 1.75, 1.7, 4.4, 'poplar', 0.08)
    m.blob(0.05, 0.08, 12.6, 1.3, 1.25, 4.2, 'poplar_dark', 0.08)
    m.dims = {'h': 17, 'r': 1.8}
    return m


@model
def tree_pine():
    m = Model('tree_pine', 14)
    m.cyl(0, 0, -0.5, 3.2, 0.3, 0.2, 6, 'bark')
    # tiers of branches, each a shallow cone, alternately turned
    tiers = [(2.4, 6.6, 2.9), (5.0, 9.4, 2.4), (7.6, 12.1, 1.85), (10.2, 14.6, 1.3), (12.6, 16.0, 0.75)]
    for k, (z0, z1, r) in enumerate(tiers):
        m.lathe(0, 0, [(z0, r), (z1, 0.0)], 8, 'pine' if k % 2 == 0 else 'pine_dark', cap_top=False, cap_bottom=True, rot=k * 0.4)
    m.dims = {'h': 16, 'r': 2.9}
    return m


@model
def tree_pine_low():
    m = Model('tree_pine_low', 15)
    m.lathe(0, 0, [(0.6, 2.9), (9.0, 1.4), (16.0, 0.0)], 6, 'pine', cap_top=False, cap_bottom=True)
    m.dims = {'h': 16, 'r': 2.9}
    return m


@model
def tree_cypress():
    m = Model('tree_cypress', 16)
    m.cyl(0, 0, -0.5, 1.0, 0.22, 0.2, 5, 'bark')
    # a slender flame: widest a third of the way up
    prof = [(0.7, 0.55), (2.5, 1.25), (5.0, 1.4), (8.0, 1.15), (11.0, 0.7), (13.2, 0.3), (14.0, 0.0)]
    m.lathe(0, 0, prof, 7, 'cypress', cap_top=False, cap_bottom=True,
            mats=['cypress_dark', 'cypress', 'cypress', 'cypress_dark', 'cypress', 'cypress'])
    m.dims = {'h': 14, 'r': 1.4}
    return m


@model
def tree_olive():
    m = Model('tree_olive', 17)
    # a gnarled trunk leaning and twisting, two limbs
    m.beam((0, 0, -0.4), (0.25, 0.1, 1.1), 0.42, 'bark_grey')
    m.beam((0.25, 0.1, 1.1), (-0.1, 0.25, 1.9), 0.34, 'bark_grey')
    m.beam((-0.1, 0.25, 1.9), (0.9, 0.4, 2.8), 0.22, 'bark_grey')
    m.beam((-0.1, 0.25, 1.9), (-0.9, -0.3, 2.7), 0.2, 'bark_grey')
    # loose silvery clumps
    m.blob(0.8, 0.4, 3.4, 1.4, 1.3, 0.9, 'olive_leaf', 0.18)
    m.blob(-0.9, -0.3, 3.3, 1.3, 1.3, 0.85, 'olive_dark', 0.18)
    m.blob(0.0, 0.1, 4.3, 1.4, 1.4, 0.95, 'olive_leaf', 0.18)
    m.dims = {'h': 5.5, 'r': 2.2}
    return m


@model
def tree_olive_low():
    m = Model('tree_olive_low', 18)
    m.blob(0, 0, 3.5, 2.1, 2.0, 1.5, 'olive_leaf', 0.18)
    m.dims = {'h': 5.5, 'r': 2.2}
    return m


# ================================================================ the Netherlands

@model
def nl_farmhouse():
    m = Model('nl_farmhouse', 21)
    x0, y0, x1, y1, wall, ridge = -4.5, -5, 4.5, 5, 3.4, 9.0
    m.walls(x0, y0, x1, y1, wall, 'brick')
    m.gable(x0, y0, x1, y1, wall, ridge, 'y', 'tile_dark', 'brick', over=0.45, thick=0.25, trim='white')
    # the front gable: a green door, windows with shutters, a window up in the gable
    m.panel('x', y0, -1, -0.6, 0.6, 0.35, 2.35, 'door_green', 0.04)
    m.panel('x', y0, -1, -0.75, 0.75, 2.35, 2.5, 'white', 0.05)
    for u in (-2.6, 2.6):
        m.window('x', y0, -1, u, 1.0, 1.1, 1.4, shutters='shutter_green')
    m.window('x', y0, -1, 0, 4.6, 0.9, 1.2)
    m.window('x', y0, -1, 0, 7.0, 0.5, 0.5)
    for x, sd in ((x0, -1), (x1, 1)):
        for u in (-3.0, 0.0, 3.0):
            m.window('y', x, sd, u, 1.0, 1.0, 1.3)
    m.box(-0.4, 2.6, 6.0, 0.4, 3.4, 10.2, 'brick_dark')
    m.box(-0.55, 2.45, 10.2, 0.55, 3.55, 10.45, 'tile_dark')
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    return m


@model
def nl_barn():
    m = Model('nl_barn', 22)
    x0, y0, x1, y1, wall, ridge = -6, -10, 6, 10, 3.0, 11.0
    m.walls(x0, y0, x1, y1, wall, 'barn_wood')
    m.hip(x0, y0, x1, y1, wall, ridge, 'y', 'thatch', over=0.7)
    # the big doors at the front, white braces
    m.panel('x', y0, -1, -2.2, 2.2, 0.35, 2.95, 'wood_dark', 0.04)
    m.beam((-2.1, y0 - 0.08, 0.45), (2.1, y0 - 0.08, 2.85), 0.14, 'white')
    m.beam((2.1, y0 - 0.08, 0.45), (-2.1, y0 - 0.08, 2.85), 0.14, 'white')
    m.panel('x', y0, -1, -2.3, 2.3, 2.85, 3.0, 'white', 0.05)
    for x, sd in ((x0, -1), (x1, 1)):
        for u in (-6, -2, 2, 6):
            m.window('y', x, sd, u, 1.1, 0.9, 0.9)
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    return m


@model
def nl_house_a():
    m = Model('nl_house_a', 23)
    x0, y0, x1, y1, wall, ridge = -3.5, -4.5, 3.5, 4.5, 5.6, 9.8
    m.walls(x0, y0, x1, y1, wall, 'brick_light')
    m.gable(x0, y0, x1, y1, wall, ridge, 'x', 'tile_dark', 'brick_light', over=0.35, thick=0.22, trim='white')
    m.panel('x', y0, -1, -0.5, 0.5, 0.35, 2.4, 'door_green', 0.04)
    for u in (-1.9, 1.9):
        m.window('x', y0, -1, u, 1.0, 1.0, 1.4)
    for u in (-1.9, 0, 1.9):
        m.window('x', y0, -1, u, 3.5, 0.9, 1.3)
    for u in (-1.9, 1.9):
        m.window('x', y1, 1, u, 1.0, 1.0, 1.4)
        m.window('x', y1, 1, u, 3.5, 0.9, 1.3)
    m.window('y', x0, -1, 0, 6.6, 0.8, 1.0)
    m.box(x1 - 1.0, -0.4, 8.0, x1 - 0.3, 0.4, 10.6, 'brick_dark')
    m.part(x0, y0, x1, y1, wall, ridge, 'x')
    return m


@model
def nl_house_b():
    m = Model('nl_house_b', 24)
    x0, y0, x1, y1, wall, ridge = -3.2, -4.5, 3.2, 4.5, 4.2, 10.0
    m.walls(x0, y0, x1, y1, wall, 'brick')
    m.gable(x0, y0, x1, y1, wall, ridge, 'y', 'tile_red', 'brick', over=0.3, thick=0.2, trim='white')
    m.panel('x', y0, -1, 0.6, 1.6, 0.35, 2.4, 'wood_dark', 0.04)
    m.window('x', y0, -1, -1.4, 1.0, 1.4, 1.5)
    m.window('x', y0, -1, -1.2, 4.7, 0.9, 1.3)
    m.window('x', y0, -1, 1.2, 4.7, 0.9, 1.3)
    m.window('x', y0, -1, 0, 7.2, 0.7, 0.9)
    for x, sd in ((x0, -1), (x1, 1)):
        m.window('y', x, sd, -2.2, 1.0, 0.9, 1.3)
        m.window('y', x, sd, 2.2, 1.0, 0.9, 1.3)
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    return m


@model
def nl_house_c():
    m = Model('nl_house_c', 25)
    x0, y0, x1, y1, wall, ridge = -4, -3.5, 4, 3.5, 2.9, 7.2
    m.walls(x0, y0, x1, y1, wall, 'brick_dark')
    m.gable(x0, y0, x1, y1, wall, ridge, 'x', 'thatch', 'brick_dark', over=0.6, thick=0.45)
    m.panel('x', y0, -1, -0.5, 0.5, 0.35, 2.3, 'door_green', 0.04)
    for u in (-2.4, 2.4):
        m.window('x', y0, -1, u, 0.9, 1.0, 1.2, shutters='shutter_green')
        m.window('x', y1, 1, u, 0.9, 1.0, 1.2, shutters='shutter_green')
    m.box(x1 - 1.1, -0.35, 5.0, x1 - 0.4, 0.35, 8.2, 'brick_dark')
    m.part(x0, y0, x1, y1, wall, ridge, 'x')
    return m


@model
def nl_church():
    m = Model('nl_church', 26)
    # the nave
    x0, y0, x1, y1, wall, ridge = -6, -8.5, 6, 15.5, 8.5, 15.5
    m.walls(x0, y0, x1, y1, wall, 'brick_church')
    m.gable(x0, y0, x1, y1, wall, ridge, 'y', 'slate', 'brick_church', over=0.4, thick=0.3)
    for x, sd in ((x0, -1), (x1, 1)):
        for u in (-4.5, -0.5, 3.5, 7.5, 11.5):
            m.window('y', x, sd, u, 2.2, 1.5, 4.0, frame='white', arch=True)
    m.window('x', y1, 1, 0, 3.0, 2.4, 5.0, frame='white', arch=True)
    # the tower in front: a brick shaft, the belfry, the clock, a copper spire with a gilded cross
    tx0, ty0, tx1, ty1, th = -3.5, -15.5, 3.5, -8.5, 26
    m.walls(tx0, ty0, tx1, ty1, th, 'brick_church')
    m.box(tx0 - 0.3, ty0 - 0.3, th, tx1 + 0.3, ty1 + 0.3, th + 0.6, 'white')
    cy = (ty0 + ty1) / 2
    for axis, plane, sd, u in (('x', ty0, -1, 0), ('x', ty1, 1, 0), ('y', tx0, -1, cy), ('y', tx1, 1, cy)):
        m.window(axis, plane, sd, u, 21.0, 1.6, 3.0, frame='white', glass='wood_dark', arch=True)
        m.panel(axis, plane, sd, u - 1.2, u + 1.2, 16.6, 19.0, 'clock', 0.04)
        m.panel(axis, plane, sd, u - 0.12, u + 0.12, 17.3, 18.2, 'cap', 0.06)
    m.panel('x', ty0, -1, -0.9, 0.9, 0.35, 3.2, 'wood_dark', 0.04)
    m.lathe(0, cy, [(th + 0.6, 3.3), (th + 4.0, 2.2), (th + 17.5, 0.0)], 8, 'copper', cap_bottom=True, rot=math.pi / 8)
    m.beam((0, cy, th + 17.3), (0, cy, th + 19.4), 0.16, 'gold')
    m.beam((-0.6, cy, th + 18.7), (0.6, cy, th + 18.7), 0.14, 'gold')
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    m.part(tx0, ty0, tx1, ty1, th + 0.6, th + 0.6)
    m.dims['spire'] = th + 18
    return m


@model
def nl_windmill():
    m = Model('nl_windmill', 27)
    # a smock mill: a brick base, the stage round it, the thatched body, the cap turned to the wind
    m.lathe(0, 0, [(-3.0, 4.4), (4.0, 4.0)], 8, 'brick_dark', cap_top=False, rot=math.pi / 8)
    m.lathe(0, 0, [(4.0, 6.2), (4.25, 6.2)], 8, 'wood_dark', cap_bottom=True, rot=math.pi / 8)
    for i in range(8):
        a = math.pi / 8 + i * math.pi / 4
        b = a + math.pi / 4
        pa = (math.cos(a) * 6.0, math.sin(a) * 6.0)
        pb = (math.cos(b) * 6.0, math.sin(b) * 6.0)
        m.beam((pa[0], pa[1], 4.25), (pa[0], pa[1], 5.2), 0.1, 'wood_dark')
        m.beam((pa[0], pa[1], 5.15), (pb[0], pb[1], 5.15), 0.1, 'wood_dark')
    m.lathe(0, 0, [(4.25, 3.7), (10.0, 2.95), (15.6, 2.2)], 8, 'thatch', cap_top=True, rot=math.pi / 8,
            mats=['thatch', 'thatch_dark'])
    m.panel('x', -4.0, -1, -0.7, 0.7, 0.35, 2.6, 'door_green', 0.12)
    m.panel('x', -3.6, -1, -0.45, 0.45, 7.2, 8.3, 'white', 0.25)
    m.panel('x', -3.6, -1, -0.35, 0.35, 7.3, 8.2, 'glass', 0.3)
    # the cap
    m.box(-2.4, -2.5, 15.5, 2.4, 2.3, 16.4, 'wood_dark')
    m.gable(-2.4, -2.5, 2.4, 2.3, 16.4, 18.6, 'y', 'thatch_dark', 'white', over=0.3, thick=0.25)
    m.beam((0, -1.5, 17.2), (0, -3.1, 17.4), 0.5, 'wood_dark')
    m.part(-4.4, -4.4, 4.4, 4.4, 19.0)
    m.dims['hub'] = [0, 17.4, 3.2]    # where the sails turn (game coordinates: x, y, z)
    return m


@model
def nl_mill_sails():
    m = Model('nl_mill_sails', 28)
    # four lattice sails on two crossed stocks, turning about the axle (game Z); the origin at the hub
    for k in range(4):
        a = k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        P = lambda r, w, c=c, s=s: (c * r - s * w, -0.25, s * r + c * w)
        m.beam(P(0, 0), P(11.6, 0), 0.32, 'wood_dark')
        for w in (0.25, 2.0):
            m.beam(P(2.0, w), P(11.2, w), 0.12, 'white')
        for r in (2.0, 3.5, 5.0, 6.5, 8.0, 9.5, 11.0):
            m.beam(P(r, 0.1), P(r, 2.05), 0.1, 'white')
    m.boxc(0, -0.1, 0, 0.9, 0.9, 0.9, 'wood_dark')
    m.dims = {'r': 11.6}
    return m


@model
def pylon():
    m = Model('pylon', 29)
    # a lattice tower: four legs, girts and cross-braces, a cross-arm for two conductors, a peak for the third
    base, topw, H = 2.4, 0.75, 27.0
    def leg(z):
        return base + (topw - base) * (z + 1) / (H + 1)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for sx, sy in corners:
        m.beam((sx * base, sy * base, -1), (sx * topw, sy * topw, H), 0.22, 'steel')
    levels = [0.5, 6.5, 12.5, 18.0, 23.0, H]
    for i, z in enumerate(levels):
        w = leg(z)
        for k in range(4):
            (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 4]
            m.beam((ax * w, ay * w, z), (bx * w, by * w, z), 0.12, 'steel')
            if i + 1 < len(levels):
                z2 = levels[i + 1]
                w2 = leg(z2)
                m.beam((ax * w, ay * w, z), (bx * w2, by * w2, z2), 0.08, 'steel_dark')
                m.beam((bx * w, by * w, z), (ax * w2, ay * w2, z2), 0.08, 'steel_dark')
    # the cross-arm (across the line: Blender x) and its braces
    m.beam((-6.3, 0, 24.3), (6.3, 0, 24.3), 0.2, 'steel')
    for sx in (-1, 1):
        m.beam((sx * 6.0, 0, 24.3), (sx * 0.9, 0, 21.8), 0.12, 'steel_dark')
        m.cyl(sx * 5.0, 0, 23.0, 24.3, 0.13, 0.13, 6, 'insulator', cap_bottom=True)
    # the peak
    for sx, sy in corners:
        m.beam((sx * topw, sy * topw, H), (0, 0, 30.4), 0.14, 'steel')
    m.cyl(0, 0, 29.0, 30.3, 0.13, 0.13, 6, 'insulator', cap_bottom=True)
    m.part(-2.4, -2.4, 2.4, 2.4, H)
    # where the conductors hang: [across, height] (game coordinates)
    m.dims['conductors'] = [[-5.0, 23.0], [5.0, 23.0], [0.0, 29.0]]
    return m


def cow(name, coat, patch, seed, bell=False, horns=True):
    m = Model(name, seed)
    # the body along Blender y, the head at the front (−y); cheap: herds are many
    m.box(-0.47, -0.95, 0.75, 0.47, 1.15, 1.65, coat)
    if patch:
        m.panel('y', 0.47, 1, 0.0, 0.9, 0.95, 1.5, patch, 0.02)
        m.panel('y', -0.47, -1, -0.6, 0.2, 1.0, 1.45, patch, 0.02)
        m.poly([(-0.3, 0.2, 1.67), (0.3, 0.2, 1.67), (0.3, 0.9, 1.67), (-0.3, 0.9, 1.67)], patch)
    for sx in (-0.3, 0.3):
        for sy in (-0.75, 0.85):
            m.box(sx - 0.09, sy - 0.09, 0.0, sx + 0.09, sy + 0.09, 0.78, coat, top=False)
    # the head, the muzzle, horns
    m.box(-0.25, -1.5, 1.2, 0.25, -0.9, 1.7, coat if not patch else 'cow_white')
    m.box(-0.21, -1.68, 1.15, 0.21, -1.45, 1.45, 'cow_nose')
    if horns:
        for sx in (-1, 1):
            m.beam((sx * 0.2, -1.1, 1.68), (sx * 0.42, -1.12, 1.9), 0.07, 'horn')
    if bell:
        m.cyl(0, -0.98, 0.95, 1.2, 0.14, 0.1, 5, 'bell', cap_bottom=True)
    return m


@model
def cow_bw():
    return cow('cow_bw', 'cow_white', 'cow_black', 31)


@model
def cow_black():
    return cow('cow_black', 'cow_black', None, 32)


@model
def cow_brown():
    return cow('cow_brown', 'cow_brown', None, 33, bell=True)


# ================================================================ Italy (Tuscany)

@model
def it_farmhouse():
    m = Model('it_farmhouse', 41)
    # a casale: a two-storey stone house, a dovecote tower at one end, a loggia, an outside stair
    x0, y0, x1, y1, wall, ridge = -8, -4.5, 4, 4.5, 6.4, 8.4
    m.walls(x0, y0, x1, y1, wall, 'stone', plinth='stone_dark')
    m.hip(x0, y0, x1, y1, wall, ridge, 'x', 'terracotta', over=0.55)
    for u in (-6.6, -4.4, -2.2):
        m.window('x', y0, -1, u, 0.35, 1.5, 1.9, frame='stone_light', glass='glass', arch=True)
    for u in (-6.4, -3.2, 0.0, 2.6):
        m.window('x', y0, -1, u, 3.9, 0.8, 1.2, frame='stone_light', shutters='shutter_olive')
    for u in (-6.4, -3.2, 0.0, 2.6):
        m.window('x', y1, 1, u, 1.2, 0.8, 1.2, frame='stone_light', shutters='shutter_olive')
        m.window('x', y1, 1, u, 3.9, 0.8, 1.2, frame='stone_light', shutters='shutter_olive')
    m.window('y', x0, -1, 0, 3.9, 0.8, 1.2, frame='stone_light', shutters='shutter_olive')
    # the outside stair up to the first-floor door
    for k in range(7):
        m.box(-0.4 + k * 0.45, y0 - 1.2, 0, 0.05 + k * 0.45 + 0.45, y0, 0.45 * (k + 1), 'stone_dark')
    m.panel('x', y0, -1, 3.0, 3.8, 3.2, 5.2, 'wood_dark', 0.04)
    # the dovecote tower
    tx0, ty0, tx1, ty1, th = 4, -2.5, 8, 2.5, 10.4
    m.walls(tx0, ty0, tx1, ty1, th, 'stone_dark', plinth='stone_dark')
    m.hip(tx0, ty0, tx1, ty1, th, th + 1.9, 'x', 'terracotta_dark', over=0.4)
    for axis, plane, sd, u in (('x', ty0, -1, 6), ('x', ty1, 1, 6), ('y', tx1, 1, 0)):
        for k in (-0.9, 0, 0.9):
            m.panel(axis, plane, sd, u + k - 0.22, u + k + 0.22, th - 1.6, th - 1.0, 'wood_dark', 0.04)
        m.window(axis, plane, sd, u, 4.4, 0.7, 1.1, frame='stone_light', shutters='shutter_olive')
    m.box(-1.0, 2.6, 7.2, -0.3, 3.3, 9.6, 'stone_dark')
    m.box(-1.15, 2.45, 9.6, -0.15, 3.45, 9.9, 'terracotta_dark')
    m.part(x0, y0, x1, y1, wall, ridge, 'x')
    m.part(tx0, ty0, tx1, ty1, th, th + 1.9, 'x')
    return m


def town_house(name, seed, w, d, wall, ridge, axis, stucco, roof, rows, shutters='shutter_olive'):
    m = Model(name, seed)
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    m.walls(x0, y0, x1, y1, wall, stucco, plinth='stone_dark')
    if axis == 'hip':
        m.hip(x0, y0, x1, y1, wall, ridge, 'x', roof, over=0.5)
    else:
        m.gable(x0, y0, x1, y1, wall, ridge, axis, roof, stucco, over=0.5, thick=0.25)
    # eaves cornice
    m.box(x0 - 0.15, y0 - 0.15, wall - 0.25, x1 + 0.15, y1 + 0.15, wall, 'stone_light', top=False)
    m.panel('x', y0, -1, -0.55, 0.55, 0.35, 2.5, 'wood_dark', 0.04)
    for z in rows:
        for u in ((-w / 4, w / 4) if z < 2 else (-w / 3, 0, w / 3)):
            if z < 2 and abs(u) < 0.8:
                continue
            m.window('x', y0, -1, u, z, 0.75, 1.25, frame='stone_light', shutters=shutters)
            m.window('x', y1, 1, u, z, 0.75, 1.25, frame='stone_light', shutters=shutters)
    for z in rows[1:]:
        m.window('y', x0, -1, 0, z, 0.75, 1.25, frame='stone_light', shutters=shutters)
        m.window('y', x1, 1, 0, z, 0.75, 1.25, frame='stone_light', shutters=shutters)
    m.part(x0, y0, x1, y1, wall, ridge, 'x' if axis in ('x', 'hip') else 'y')
    return m


@model
def it_house_a():
    return town_house('it_house_a', 42, 7, 9, 8.2, 9.8, 'x', 'stucco_ochre', 'terracotta', (1.2, 4.1, 6.6))


@model
def it_house_b():
    return town_house('it_house_b', 43, 8, 8, 5.6, 7.4, 'hip', 'stone', 'terracotta_dark', (1.2, 3.8))


@model
def it_house_c():
    return town_house('it_house_c', 44, 6, 8, 9.0, 10.6, 'y', 'stucco_pink', 'terracotta', (1.2, 4.2, 7.0))


@model
def it_tower():
    m = Model('it_tower', 45)
    # a medieval tower: tall, stone, slit windows, battlements
    s, h = 3.5, 30.0
    m.walls(-s, -s, s, s, h, 'stone_dark', plinth='stone_dark')
    m.box(-s - 0.35, -s - 0.35, h - 0.6, s + 0.35, s + 0.35, h, 'stone', top=True)
    for k in range(4):
        for t in (-2.6, 0, 2.6):
            c = [(t, -s - 0.2), (s + 0.2, t), (t, s + 0.2), (-s - 0.2, t)][k]
            m.boxc(c[0], c[1], h + 0.6, 1.3 if k % 2 == 0 else 0.7, 0.7 if k % 2 == 0 else 1.3, 1.2, 'stone')
    for axis, plane, sd in (('x', -s, -1), ('x', s, 1), ('y', -s, -1), ('y', s, 1)):
        for z in (7.0, 13.5, 20.0, 25.5):
            m.panel(axis, plane, sd, -0.22, 0.22, z, z + 1.4, 'wood_dark', 0.04)
    m.window('x', -s, -1, 0, 0.35, 1.4, 2.0, frame='stone_light', glass='wood_dark', arch=True)
    m.part(-s - 0.35, -s - 0.35, s + 0.35, s + 0.35, h + 1.2)
    return m


@model
def hay_bale():
    m = Model('hay_bale', 46)
    # a round bale lying on its side (its axis along Blender x)
    r, L, n = 0.78, 1.25, 10
    ring = lambda x: [(x, math.cos(a) * r, r + math.sin(a) * r) for a in (i * 2 * math.pi / n for i in range(n))]
    a, b = ring(-L / 2), ring(L / 2)
    for i in range(n):
        j = (i + 1) % n
        m.poly([a[i], a[j], b[j], b[i]], 'hay')
    m.poly(list(reversed(a)), 'hay_dark')
    m.poly(b, 'hay_dark')
    return m


# ================================================================ Switzerland

@model
def ch_chalet():
    m = Model('ch_chalet', 51)
    # a stone ground floor, a wooden upper floor with a balcony and flowers, a wide low roof over the valley
    x0, y0, x1, y1, wall, ridge = -5, -4, 5, 4, 5.2, 7.8
    m.walls(x0, y0, x1, y1, 2.6, 'stone_grey', plinth='stone_grey_dark')
    m.box(x0 - 0.1, y0 - 0.1, 2.6, x1 + 0.1, y1 + 0.1, wall, 'chalet_wood', top=False)
    m.gable(x0 - 0.1, y0 - 0.1, x1 + 0.1, y1 + 0.1, wall, ridge, 'y', 'wood_grey', 'chalet_wood', over=1.3, thick=0.3)
    # the balcony along the front
    m.box(x0 - 0.3, y0 - 1.3, 2.7, x1 + 0.3, y0 - 0.1, 2.88, 'chalet_dark', bottom=True)
    m.box(x0 - 0.3, y0 - 1.35, 2.88, x1 + 0.3, y0 - 1.2, 3.75, 'chalet_dark')
    for x in (x0 - 0.3, x1 + 0.3):
        m.box(x - 0.08, y0 - 1.35, 2.88, x + 0.08, y0 - 0.1, 3.75, 'chalet_dark')
    m.box(x0 - 0.2, y0 - 1.55, 3.6, x1 + 0.2, y0 - 1.35, 3.95, 'leaves_box')
    for k in range(9):
        xx = x0 + 0.4 + k * (x1 - x0 - 0.8) / 8
        m.boxc(xx, y0 - 1.45, 4.02, 0.5, 0.3, 0.18, 'flowers' if k % 3 else 'flowers_pink', bottom=False)
    # windows: small on the stone floor, with green shutters above the balcony, one in the gable
    for u in (-3.0, 3.0):
        m.window('x', y0, -1, u, 0.9, 0.8, 0.9)
    m.panel('x', y0, -1, -0.55, 0.55, 0.35, 2.3, 'wood_dark', 0.04)
    for u in (-3.0, 0.0, 3.0):
        m.window('x', y0 - 0.1, -1, u, 3.8, 0.9, 1.1, shutters='shutter_green')
    m.window('x', y0 - 0.1, -1, 0, 6.0, 0.8, 0.8)
    for x, sd in ((x0, -1), (x1, 1)):
        for u in (-2.0, 2.0):
            m.window('y', x - 0.1 * sd * -1, sd, u, 3.8, 0.9, 1.1, shutters='shutter_green')
    m.box(x1 - 1.6, 1.0, 6.5, x1 - 0.9, 1.7, 8.6, 'stone_grey_dark')
    m.part(x0 - 0.3, y0 - 1.3, x1 + 0.3, y1, wall, ridge, 'y')
    return m


@model
def ch_barn():
    m = Model('ch_barn', 52)
    # a hay barn (a Stadel): dark timber on a stone footing
    x0, y0, x1, y1, wall, ridge = -3.5, -3, 3.5, 3, 4.2, 6.4
    m.walls(x0, y0, x1, y1, 1.0, 'stone_grey', plinth='stone_grey_dark')
    m.box(x0, y0, 1.0, x1, y1, wall, 'chalet_dark', top=False)
    for z in (1.8, 2.6, 3.4):
        m.panel('x', y0, -1, x0, x1, z, z + 0.06, 'wood_dark', 0.03)
    m.gable(x0, y0, x1, y1, wall, ridge, 'y', 'wood_grey', 'chalet_dark', over=0.7, thick=0.25)
    m.panel('x', y0, -1, -0.8, 0.8, 1.0, 3.2, 'wood_dark', 0.04)
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    return m


@model
def ch_church():
    m = Model('ch_church', 53)
    x0, y0, x1, y1, wall, ridge = -4.5, -5.5, 4.5, 10.5, 7.0, 11.5
    m.walls(x0, y0, x1, y1, wall, 'white', plinth='stone_grey_dark')
    m.gable(x0, y0, x1, y1, wall, ridge, 'y', 'slate', 'white', over=0.4, thick=0.25)
    for x, sd in ((x0, -1), (x1, 1)):
        for u in (-2.5, 2.0, 6.5):
            m.window('y', x, sd, u, 2.2, 1.2, 3.0, frame='stone_grey', arch=True)
    # the tower: white, a clock, the belfry, a tall slate spire
    tx0, ty0, tx1, ty1, th = -2.5, -10.5, 2.5, -5.5, 19.0
    m.walls(tx0, ty0, tx1, ty1, th, 'white', plinth='stone_grey_dark')
    cy = (ty0 + ty1) / 2
    for axis, plane, sd, u in (('x', ty0, -1, 0), ('y', tx0, -1, cy), ('y', tx1, 1, cy), ('x', ty1, 1, 0)):
        m.window(axis, plane, sd, u, 15.4, 1.2, 2.2, frame='stone_grey', glass='wood_dark', arch=True)
        m.panel(axis, plane, sd, u - 0.9, u + 0.9, 12.4, 14.2, 'clock', 0.04)
        m.panel(axis, plane, sd, u - 0.1, u + 0.1, 12.9, 13.7, 'gold', 0.06)
    m.panel('x', ty0, -1, -0.8, 0.8, 0.35, 2.8, 'wood_dark', 0.04)
    m.lathe(0, cy, [(th, 3.0), (th + 12.0, 0.0)], 4, 'slate', cap_bottom=True, rot=math.pi / 4)
    m.beam((0, cy, th + 11.8), (0, cy, th + 13.4), 0.14, 'gold')
    m.beam((-0.45, cy, th + 12.9), (0.45, cy, th + 12.9), 0.12, 'gold')
    m.part(x0, y0, x1, y1, wall, ridge, 'y')
    m.part(tx0, ty0, tx1, ty1, th + 2, th + 12, 'x')
    return m


@model
def ch_station():
    m = Model('ch_station', 54)
    # a cable-car station: concrete, open towards the cable (Blender +y)
    x0, y0, x1, y1, h = -4.5, -5, 4.5, 5, 5.5
    m.box(x0, y0, -3, x1, y1, h, 'concrete', mats={'back': 'concrete_dark'})
    m.panel('x', y1, 1, -2.4, 2.4, 1.0, 4.6, 'glass', 0.04)
    m.gable(x0, y0, x1, y1, h, h + 1.2, 'x', 'concrete_dark', 'concrete', over=0.5, thick=0.3)
    m.panel('x', y0, -1, -0.7, 0.7, 0.0, 2.3, 'gondola', 0.04)
    m.window('y', x0, -1, 0, 2.0, 2.6, 1.2, frame='concrete_dark')
    m.window('y', x1, 1, 0, 2.0, 2.6, 1.2, frame='concrete_dark')
    m.part(x0, y0, x1, y1, h, h + 1.2, 'x')
    return m


@model
def ch_gondola():
    m = Model('ch_gondola', 55)
    # hangs from the cable at its origin
    m.boxc(0, 0, -0.15, 0.5, 1.0, 0.35, 'steel_dark')
    m.beam((0, 0, -0.2), (0, 0, -2.6), 0.14, 'steel_dark')
    m.box(-1.2, -1.1, -5.0, 1.2, 1.1, -2.85, 'gondola', bottom=True)
    m.box(-1.3, -1.2, -2.85, 1.3, 1.2, -2.6, 'white', bottom=True)
    for axis, plane, sd in (('x', -1.1, -1), ('x', 1.1, 1)):
        m.panel(axis, plane, sd, -1.0, 1.0, -4.1, -3.1, 'glass', 0.03)
    for axis, plane, sd in (('y', -1.2, -1), ('y', 1.2, 1)):
        m.panel(axis, plane, sd, -0.9, 0.9, -4.1, -3.1, 'glass', 0.03)
    return m


# ================================================================ the balloon's basket and crew

@model
def basket():
    m = Model('basket', 61)
    s, h = 0.62, 1.12
    # wicker sides in bands, a padded leather rim, a darker floor runner
    bands = [(0.0, 0.18, 'wicker_dark'), (0.18, 0.5, 'wicker'), (0.5, 0.56, 'wicker_dark'), (0.56, 0.98, 'wicker'), (0.98, 1.02, 'wicker_dark')]
    for z0, z1, mat in bands:
        m.box(-s, -s, z0, s, s, z1, mat, top=False, bottom=(z0 == 0))
    e, t = s + 0.07, 0.15
    for x0, y0, x1, y1 in ((-e, -e, e, -e + t), (-e, e - t, e, e), (-e, -e, -e + t, e), (e - t, -e, e, e)):
        m.box(x0, y0, h - 0.1, x1, y1, h + 0.05, 'leather')
    m.box(-s + 0.02, -s + 0.02, 0.0, s - 0.02, s - 0.02, 0.12, 'wicker_dark')
    # the crew: a pilot in a cap and three passengers, leaning on the rim
    crew = [((-0.3, -0.28), 'coat_blue', 'skin_a', 'cap'), ((0.3, -0.28), 'coat_red', 'skin_c', 'hair_blond'),
            ((-0.3, 0.3), 'coat_green', 'skin_b', 'hair_dark'), ((0.3, 0.3), 'coat_yellow', 'skin_d', 'hair_dark')]
    for (x, y), coat, skin, hair in crew:
        m.boxc(x, y, h + 0.15, 0.38, 0.26, 0.5, coat)
        m.boxc(x, y, h + 0.43, 0.14, 0.12, 0.08, skin)
        m.blob(x, y, h + 0.6, 0.14, 0.14, 0.16, skin, 0.05)
        m.blob(x, y + 0.02, h + 0.69, 0.15, 0.15, 0.09, hair, 0.05)
        if hair == 'cap':
            m.boxc(x, y - 0.12, h + 0.66, 0.2, 0.12, 0.04, 'cap')
    # the burner frame on its four poles, the twin burner, the blast valves
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        m.beam((sx * s * 0.9, sy * s * 0.9, h), (sx * 0.42, sy * 0.42, 2.4), 0.05, 'burner_dark')
    for k in range(4):
        a = [(0.45, 0.45), (-0.45, 0.45), (-0.45, -0.45), (0.45, -0.45)]
        m.beam((a[k][0], a[k][1], 2.42), (a[(k + 1) % 4][0], a[(k + 1) % 4][1], 2.42), 0.07, 'burner')
    for x in (-0.18, 0.18):
        m.cyl(x, 0, 2.36, 2.72, 0.13, 0.15, 8, 'burner', cap_bottom=True)
        m.cyl(x, 0, 2.47, 2.57, 0.165, 0.165, 8, 'burner_dark', cap_top=False)
    m.beam((-0.18, -0.2, 2.36), (-0.18, -0.4, 2.1), 0.05, 'burner_dark')
    m.beam((0.18, -0.2, 2.36), (0.18, -0.4, 2.1), 0.05, 'burner_dark')
    return m
