import { describe, expect, it } from 'vitest';
import { regionOf, viewerCountry } from './viewerCountry';

/**
 * Смысл этих тестов — не разбор строки, а ЗАПРЕТ НА ДОГАДКУ.
 *
 * Стоит кому-нибудь добавить сюда `maximize()` или таблицу «язык → страна»,
 * и половина читателей увидит чужого вещателя под видом своего. Случаи ниже
 * подобраны так, чтобы такая правка их уронила.
 */
describe('regionOf', () => {
  it('берёт объявленный регион', () => {
    expect(regionOf('ru-RU')).toBe('RU');
    expect(regionOf('en-GB')).toBe('GB');
    expect(regionOf('pt-BR')).toBe('BR');
    expect(regionOf('es-MX')).toBe('MX');
  });

  it('приводит к верхнему регистру и понимает подчёркивание', () => {
    expect(regionOf('en-us')).toBe('US');
    expect(regionOf('pt_br')).toBe('BR');
  });

  it('ЯЗЫК БЕЗ РЕГИОНА — ЭТО НЕ СТРАНА', () => {
    // Каждый из них имеет «очевидную» страну, и ни одна не объявлена.
    expect(regionOf('ru')).toBeNull();
    expect(regionOf('en')).toBeNull();
    expect(regionOf('es')).toBeNull();
    expect(regionOf('pt')).toBeNull();
    expect(regionOf('ja')).toBeNull();
  });

  it('пропускает письменность и берёт регион за ней', () => {
    expect(regionOf('zh-Hans-CN')).toBe('CN');
    expect(regionOf('sr-Cyrl-RS')).toBe('RS');
  });

  it('письменность без региона страной не считается', () => {
    // 'Hans' — четыре буквы, не две: под регион не подходит и не должен.
    expect(regionOf('zh-Hans')).toBeNull();
    expect(regionOf('az-Latn')).toBeNull();
  });

  it('числовой код региона страной не считается', () => {
    // '419' — Латинская Америка. Это не страна, и сопоставить её со списком
    // правообладателей нечем.
    expect(regionOf('es-419')).toBeNull();
  });

  it('на мусоре возвращает null, а не бросает', () => {
    expect(regionOf('')).toBeNull();
    expect(regionOf(null)).toBeNull();
    expect(regionOf(undefined)).toBeNull();
    expect(regionOf('!!!')).toBeNull();
    expect(regionOf('-')).toBeNull();
  });
});

describe('viewerCountry', () => {
  it('язык приложения важнее системного', () => {
    expect(viewerCountry('pt-BR', ['en-US'])).toBe('BR');
  });

  it('падает на системный, когда язык приложения региона не объявляет', () => {
    expect(viewerCountry('ru', ['ru-RU', 'en-US'])).toBe('RU');
  });

  it('берёт первый системный тег С РЕГИОНОМ, а не первый вообще', () => {
    expect(viewerCountry('en', ['fr', 'de-AT'])).toBe('AT');
  });

  it('ничего не объявлено — страны нет', () => {
    expect(viewerCountry('en', ['fr', 'de'])).toBeNull();
    expect(viewerCountry(null, [])).toBeNull();
  });
});
