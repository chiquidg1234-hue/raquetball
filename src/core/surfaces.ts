/**
 * Catalogo de superficies: de que estan hechas las paredes y el piso.
 *
 * Lo que dice la investigacion (INVESTIGACION.md, seccion 2), sin adornos:
 *   - No hay UNA sola medida publicada del rebote de una pelota de
 *     racquetball contra panel, revoque, hormigon o cristal.
 *   - La patente de los paneles afirma que devuelven la pelota "igual" que
 *     una pared de hormigon (US 4068840).
 *   - Del cristal hay dos fuentes con la misma direccion (algo mas rapido:
 *     padel, squash) y ninguna con un numero para racquetball.
 *
 * Por eso TODAS arrancan con factor de COR 1 y la misma restitucion
 * tangencial, y el panel Cancha deja calibrar paredes y piso a mano. La
 * hipotesis "el hormigon devuelve mas y raspa mas" no tiene respaldo
 * publicado y no se codifica como dato.
 */

import { BALL } from './constants.js';

export type WallMaterialId = 'panel' | 'plaster' | 'glass';
export type FloorMaterialId = 'wood' | 'concrete';

export interface SurfaceMaterial<Id extends string> {
  id: Id;
  name: string;
  /** Una linea para el panel: que es y de donde sale. */
  detail: string;
  /** Multiplica el COR de la pelota. 1 = sin dato que diga otra cosa. */
  corFactor: number;
  /** Restitucion tangencial por defecto. */
  tangential: number;
}

export const WALL_MATERIALS: Record<WallMaterialId, SurfaceMaterial<WallMaterialId>> = {
  panel: {
    id: 'panel',
    name: 'Paneles prefabricados ("placa")',
    detail:
      'Melamina sobre aglomerado denso, tipo Fiberesin. Su patente dice que rebota igual que el hormigón.',
    corFactor: 1,
    tangential: BALL.tangentialRestitution,
  },
  plaster: {
    id: 'plaster',
    name: 'Revoque sobre ladrillo u hormigón',
    detail:
      'La construcción clásica: "superficie lisa y uniforme, rebote consistente". Sin medida publicada.',
    corFactor: 1,
    tangential: BALL.tangentialRestitution,
  },
  glass: {
    id: 'glass',
    name: 'Cristal templado (cancha estadio)',
    detail:
      'En pádel y squash rebota algo más rápido; no hay número para racquetball. Calíbralo.',
    corFactor: 1,
    tangential: BALL.tangentialRestitution,
  },
};

export const FLOOR_MATERIALS: Record<FloorMaterialId, SurfaceMaterial<FloorMaterialId>> = {
  wood: {
    id: 'wood',
    name: 'Duela de madera (arce)',
    detail: 'El piso de los sistemas de cancha. Sin medida publicada de rebote.',
    corFactor: 1,
    tangential: BALL.tangentialRestitution,
  },
  concrete: {
    id: 'concrete',
    name: 'Cemento',
    detail: 'Habitual en canchas sin sistema de piso. Sin medida publicada de rebote.',
    corFactor: 1,
    tangential: BALL.tangentialRestitution,
  },
};

export const WALL_MATERIAL_IDS = Object.keys(WALL_MATERIALS) as WallMaterialId[];
export const FLOOR_MATERIAL_IDS = Object.keys(FLOOR_MATERIALS) as FloorMaterialId[];

export const isWallMaterialId = (v: unknown): v is WallMaterialId =>
  typeof v === 'string' && v in WALL_MATERIALS;
export const isFloorMaterialId = (v: unknown): v is FloorMaterialId =>
  typeof v === 'string' && v in FLOOR_MATERIALS;

/** Rango de calibracion que ofrece el panel. */
export const COR_FACTOR_RANGE = { min: 0.85, max: 1.1 } as const;
export const TANGENTIAL_RANGE = { min: 0.3, max: 0.95 } as const;
