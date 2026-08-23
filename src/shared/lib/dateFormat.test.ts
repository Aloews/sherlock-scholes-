import { describe, it, expect } from 'vitest';
import {
  timeFormat, weekdayDateFormat, shortDateFormat, longDateFormat,
  longDateWithYearFormat, dateTimeFormat, monthYearFormat, weekdayShortFormat,
} from './dateFormat';

// Каждая функция здесь — это только набор опций Intl.DateTimeFormat, и весь
// риск в том, что он незаметно разъедется с тем, что обещает комментарий над
// функцией (или с тем, что ждёт второй вызывающий той же формы). Проверяем
// resolvedOptions(), а не отрендеренную строку: час в строке зависит от
// часового пояса машины, где идёт тест, набор полей — нет.

describe('timeFormat', () => {
  it('час и минута, без даты', () => {
    const o = timeFormat('en').resolvedOptions();
    expect(o.hour).toBe('2-digit');
    expect(o.minute).toBe('2-digit');
    expect(o.weekday).toBeUndefined();
    expect(o.day).toBeUndefined();
    expect(o.month).toBeUndefined();
    expect(o.year).toBeUndefined();
  });
});

describe('weekdayDateFormat', () => {
  it('день недели, число, полный месяц — без года и времени', () => {
    const o = weekdayDateFormat('en').resolvedOptions();
    expect(o.weekday).toBe('long');
    expect(o.day).toBe('numeric');
    expect(o.month).toBe('long');
    expect(o.year).toBeUndefined();
    expect(o.hour).toBeUndefined();
  });
});

describe('shortDateFormat', () => {
  it('число и короткий месяц — не то же самое, что longDateFormat', () => {
    const o = shortDateFormat('en').resolvedOptions();
    expect(o.day).toBe('numeric');
    expect(o.month).toBe('short');
    expect(o.weekday).toBeUndefined();
    expect(o.year).toBeUndefined();
  });
});

describe('longDateFormat', () => {
  it('число и полный месяц, без года — не то же самое, что longDateWithYearFormat', () => {
    const o = longDateFormat('en').resolvedOptions();
    expect(o.day).toBe('numeric');
    expect(o.month).toBe('long');
    expect(o.year).toBeUndefined();
  });
});

describe('longDateWithYearFormat', () => {
  it('число, полный месяц и год', () => {
    const o = longDateWithYearFormat('en').resolvedOptions();
    expect(o.day).toBe('numeric');
    expect(o.month).toBe('long');
    expect(o.year).toBe('numeric');
  });
});

describe('dateTimeFormat', () => {
  it('дата полным месяцем плюс час и минута, без года', () => {
    const o = dateTimeFormat('en').resolvedOptions();
    expect(o.day).toBe('numeric');
    expect(o.month).toBe('long');
    expect(o.hour).toBe('2-digit');
    expect(o.minute).toBe('2-digit');
    expect(o.year).toBeUndefined();
  });
});

describe('monthYearFormat', () => {
  it('месяц и год, без числа', () => {
    const o = monthYearFormat('en').resolvedOptions();
    expect(o.month).toBe('long');
    expect(o.year).toBe('numeric');
    expect(o.day).toBeUndefined();
  });
});

describe('weekdayShortFormat', () => {
  it('только короткий день недели', () => {
    const o = weekdayShortFormat('en').resolvedOptions();
    expect(o.weekday).toBe('short');
    expect(o.day).toBeUndefined();
    expect(o.month).toBeUndefined();
  });
});
