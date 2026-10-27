import type { Person } from '../api';
import { img } from '../api';

export function Avatar({ person, size }: { person: Person | undefined; size: number }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-stage text-muted"
      style={{ width: size, height: size }}
    >
      {person?.photo ? (
        <img src={img(person.photo)} alt="" className="size-full object-cover" />
      ) : (
        <span className="font-serif leading-none" style={{ fontSize: size * 0.48 }}>
          {person?.name[0]}
        </span>
      )}
    </span>
  );
}
