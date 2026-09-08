import { describe, it, expect } from 'vitest';
import { careerRowMeta } from './careerRowMeta';

describe('careerRowMeta', () => {
  it('числа вытесняют годы — это и есть вся правка', () => {
    const got = careerRowMeta({ years: '2004–2021', apps: 520, goals: 474 });
    expect(got.kind).toBe('numbers');
    expect(got.apps).toBe(520);
    expect(got.goals).toBe(474);
  });

  it('без чисел остаются годы: у легенды другого нет', () => {
    // `legend_career.clubs` несёт только годы — заменить их нечем.
    expect(careerRowMeta({ years: '1970–1974' }).kind).toBe('years');
    expect(careerRowMeta({ years: '1970–1974', apps: null, goals: null }).kind).toBe('years');
  });

  it('НОЛЬ матчей — не достижение, а отсутствие данных', () => {
    // ⚠️ В инфобоксе «0» стоит и у клуба, за который не сыграл, и у клуба,
    // про который Википедия не знает. «0 матчей» утверждало бы первое.
    expect(careerRowMeta({ years: '2019–2020', apps: 0, goals: 0 }).kind).toBe('years');
  });

  it('голы без матчей числами не считаются', () => {
    // Голы есть, матчей нет — это битая строка, а не «забил, не выходя».
    expect(careerRowMeta({ years: '2019', apps: 0, goals: 3 }).kind).toBe('years');
  });

  it('нет ни чисел, ни годов — показывать нечего', () => {
    expect(careerRowMeta({}).kind).toBeNull();
    expect(careerRowMeta({ years: '   ' }).kind).toBeNull();
    expect(careerRowMeta({ years: null, apps: null, goals: null }).kind).toBeNull();
  });

  it('ноль голов при матчах — настоящий ноль и показывается', () => {
    // Защитник с 200 матчами и 0 голов — это факт, а не пропуск.
    const got = careerRowMeta({ years: '2010–2018', apps: 200, goals: 0 });
    expect(got.kind).toBe('numbers');
    expect(got.goals).toBe(0);
  });
});
