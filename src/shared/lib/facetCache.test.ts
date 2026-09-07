// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFacets, writeFacets } from './facetCache';
import type { CollectionFacet } from '@/features/collection/collectionApi';

const facets: CollectionFacet[] = [
  { kind: 'league', value: 'Англия. Премьер-лига', label: 'Англия. Премьер-лига', n: 558 },
];

describe('facetCache', () => {
  beforeEach(() => localStorage.clear());

  it('записанное читается обратно', () => {
    writeFacets('player', facets);
    expect(readFacets('player')).toEqual(facets);
  });

  it('чужая категория не отдаётся: у клубов свой набор', () => {
    writeFacets('player', facets);
    expect(readFacets('club')).toBeNull();
  });

  // ⚠️ ПУСТОЙ ОТВЕТ НЕ КЭШИРУЕТСЯ. Одна неудачная загрузка иначе закрепила бы
  // пустой список на сутки, и отбор исчез бы с экрана без единой ошибки.
  it('пустой список не сохраняется', () => {
    writeFacets('player', facets);
    writeFacets('player', []);
    expect(readFacets('player')).toEqual(facets);
  });

  it('просроченное не отдаётся', () => {
    writeFacets('player', facets);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    expect(readFacets('player')).toBeNull();
    vi.restoreAllMocks();
  });

  it('мусор в хранилище не роняет чтение', () => {
    localStorage.setItem('ss_facets_v1', '{не json');
    expect(readFacets('player')).toBeNull();
  });

  // ⚠️ В приватном окне САМ ДОСТУП к localStorage бросает, а не возвращает
  // null. Непойманное исключение здесь уронило бы экран целиком.
  it('бросающее хранилище не роняет ни чтение, ни запись', () => {
    const boom = () => { throw new Error('SecurityError'); };
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    expect(readFacets('player')).toBeNull();
    expect(() => writeFacets('player', facets)).not.toThrow();
    vi.restoreAllMocks();
    if (orig) Object.defineProperty(Storage.prototype, 'getItem', orig);
  });
});
