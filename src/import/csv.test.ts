import { describe, expect, it } from 'vitest';
import { detectFormat, parseCsv, parseDate, toSets } from './csv';

describe('csv parsing', () => {
  it('handles quotes, commas in fields and semicolon delimiters', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
    expect(parseCsv('a;b\r\n1,5;8')).toEqual([['a', 'b'], ['1,5', '8']]);
  });
  it('parses date formats', () => {
    expect(parseDate('2024-01-15 17:30:00')).toBe('2024-01-15');
    expect(parseDate('15 Jan 2024, 17:30')).toBe('2024-01-15');
    expect(parseDate('5.3.2024')).toBe('2024-03-05');
  });
});

describe('Strong export', () => {
  const csv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-01-15 17:30:00,"Upper A",1h,"Bench Press (Barbell)",1,60,8,0,0,,,8
2024-01-15 17:30:00,"Upper A",1h,"Bench Press (Barbell)",2,60,7,0,0,,,
2024-01-15 17:30:00,"Upper A",1h,"Bench Press (Barbell)",Rest Timer,0,0,0,90,,,`;
  it('reads sets and skips rest-timer rows', () => {
    const rows = parseCsv(csv);
    expect(detectFormat(rows[0])).toBe('strong');
    const { sets, skipped } = toSets(rows, 'strong');
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ date: '2024-01-15', exercise: 'Bench Press (Barbell)', setNo: 1, weight: 60, reps: 8, rir: 2 });
    expect(skipped).toBe(1);
  });
});

describe('Hevy export', () => {
  const csv = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Upper B","15 Jan 2024, 17:30","15 Jan 2024, 18:30","","Pull Up","","",0,"warmup",,5,,,
"Upper B","15 Jan 2024, 17:30","15 Jan 2024, 18:30","","Pull Up","","",1,"normal",,9,,,
"Upper B","15 Jan 2024, 17:30","15 Jan 2024, 18:30","","Incline Bench Press (Dumbbell)","","",0,"normal",22,10,,,`;
  it('reads sets, skips warmups, handles bodyweight', () => {
    const rows = parseCsv(csv);
    expect(detectFormat(rows[0])).toBe('hevy');
    const { sets } = toSets(rows, 'hevy');
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ exercise: 'Pull Up', weight: 0, reps: 9, setNo: 2 });
    expect(sets[1]).toMatchObject({ exercise: 'Incline Bench Press (Dumbbell)', weight: 22, reps: 10 });
  });
});

describe('generic notebook CSV', () => {
  it('uses a column mapping and numbers sets', () => {
    const rows = parseCsv('päivä;liike;paino;toistot\n15.1.2024;Penkki;60;8\n15.1.2024;Penkki;60;7');
    const { sets } = toSets(rows, 'generic', { date: 0, exercise: 1, weight: 2, reps: 3 });
    expect(sets.map((s) => s.setNo)).toEqual([1, 2]);
  });
});
