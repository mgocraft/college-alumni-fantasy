
export type Leader = { player_id: string | number; full_name: string; position: string; team?: string; points: number; college?: string | null; };
export type SchoolAggregate = {
  school: string; week: number; format: string; totalPoints: number;
  performers: { name: string; position: string; team?: string; points: number; meta?: any }[];
};
