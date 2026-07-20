// ISO 3166-1 alpha-2 (+ GB-ENG/SCT/WLS subdivisions) -> Russian country name.
// Used with isoToFlag() for the history line "🇩🇪 Германия · Защитник".
// Codes not listed fall back to the raw code (still prefixed with the flag).

export const COUNTRY_NAME_RU: Record<string, string> = {
  // Europe
  AL: 'Албания', AD: 'Андорра', AM: 'Армения', AT: 'Австрия', AZ: 'Азербайджан',
  BY: 'Беларусь', BE: 'Бельгия', BA: 'Босния и Герцеговина', BG: 'Болгария',
  HR: 'Хорватия', CY: 'Кипр', CZ: 'Чехия', DK: 'Дания', EE: 'Эстония',
  FI: 'Финляндия', FR: 'Франция', GE: 'Грузия', DE: 'Германия', GR: 'Греция',
  HU: 'Венгрия', IS: 'Исландия', IL: 'Израиль', IT: 'Италия', KZ: 'Казахстан',
  XK: 'Косово', LV: 'Латвия', LI: 'Лихтенштейн', LT: 'Литва', LU: 'Люксембург',
  MT: 'Мальта', MD: 'Молдова', MC: 'Монако', ME: 'Черногория', NL: 'Нидерланды',
  MK: 'Северная Македония', NO: 'Норвегия', PL: 'Польша', PT: 'Португалия',
  IE: 'Ирландия', RO: 'Румыния', RU: 'Россия', SM: 'Сан-Марино', RS: 'Сербия',
  SK: 'Словакия', SI: 'Словения', ES: 'Испания', SE: 'Швеция', CH: 'Швейцария',
  TR: 'Турция', UA: 'Украина', FO: 'Фарерские острова', GI: 'Гибралтар',
  GB: 'Великобритания', 'GB-ENG': 'Англия', 'GB-SCT': 'Шотландия', 'GB-WLS': 'Уэльс',
  // South America
  AR: 'Аргентина', BO: 'Боливия', BR: 'Бразилия', CL: 'Чили', CO: 'Колумбия',
  EC: 'Эквадор', GY: 'Гайана', PY: 'Парагвай', PE: 'Перу', SR: 'Суринам',
  UY: 'Уругвай', VE: 'Венесуэла',
  // Africa
  DZ: 'Алжир', AO: 'Ангола', BJ: 'Бенин', BF: 'Буркина-Фасо', BI: 'Бурунди',
  CM: 'Камерун', CV: 'Кабо-Верде', CF: 'ЦАР', TD: 'Чад', KM: 'Коморы',
  CG: 'Конго', CD: 'ДР Конго', CI: 'Кот-д’Ивуар', EG: 'Египет',
  GQ: 'Экваториальная Гвинея', SZ: 'Эсватини', GA: 'Габон', GM: 'Гамбия',
  GH: 'Гана', GN: 'Гвинея', GW: 'Гвинея-Бисау', KE: 'Кения', LR: 'Либерия',
  LY: 'Ливия', MG: 'Мадагаскар', MW: 'Малави', ML: 'Мали', MR: 'Мавритания',
  MU: 'Маврикий', MA: 'Марокко', MZ: 'Мозамбик', NA: 'Намибия', NE: 'Нигер',
  NG: 'Нигерия', RW: 'Руанда', SN: 'Сенегал', SL: 'Сьерра-Леоне', SO: 'Сомали',
  ZA: 'ЮАР', SS: 'Южный Судан', SD: 'Судан', TZ: 'Танзания', TG: 'Того',
  TN: 'Тунис', UG: 'Уганда', ZM: 'Замбия', ZW: 'Зимбабве',
  // Asia + Oceania
  AF: 'Афганистан', AU: 'Австралия', BH: 'Бахрейн', BD: 'Бангладеш',
  KH: 'Камбоджа', CN: 'Китай', HK: 'Гонконг', IN: 'Индия', ID: 'Индонезия',
  IR: 'Иран', IQ: 'Ирак', JP: 'Япония', JO: 'Иордания', KR: 'Южная Корея',
  KP: 'Северная Корея', KW: 'Кувейт', KG: 'Киргизия', LB: 'Ливан',
  MY: 'Малайзия', MN: 'Монголия', MM: 'Мьянма', NP: 'Непал', OM: 'Оман',
  PS: 'Палестина', PH: 'Филиппины', QA: 'Катар', SA: 'Саудовская Аравия',
  SG: 'Сингапур', SY: 'Сирия', TJ: 'Таджикистан', TH: 'Таиланд',
  TM: 'Туркменистан', AE: 'ОАЭ', UZ: 'Узбекистан', VN: 'Вьетнам', YE: 'Йемен',
  NZ: 'Новая Зеландия', FJ: 'Фиджи', PG: 'Папуа — Новая Гвинея',
  // North America / Caribbean
  AG: 'Антигуа и Барбуда', AW: 'Аруба', BS: 'Багамы', BB: 'Барбадос',
  BZ: 'Белиз', BM: 'Бермуды', CA: 'Канада', KY: 'Каймановы острова',
  CR: 'Коста-Рика', CU: 'Куба', CW: 'Кюрасао', DM: 'Доминика',
  DO: 'Доминиканская Республика', SV: 'Сальвадор', GD: 'Гренада',
  GP: 'Гваделупа', GT: 'Гватемала', HT: 'Гаити', HN: 'Гондурас', JM: 'Ямайка',
  MQ: 'Мартиника', MX: 'Мексика', MS: 'Монтсеррат', NI: 'Никарагуа',
  PA: 'Панама', PR: 'Пуэрто-Рико', LC: 'Сент-Люсия', KN: 'Сент-Китс и Невис',
  TT: 'Тринидад и Тобаго', US: 'США',
};

// English country names. Only codes that occur in our deck need an entry;
// anything missing falls back to the raw ISO code.
export const COUNTRY_NAME_EN: Record<string, string> = {
  AL: 'Albania', AD: 'Andorra', AM: 'Armenia', AT: 'Austria', AZ: 'Azerbaijan',
  BY: 'Belarus', BE: 'Belgium', BA: 'Bosnia and Herzegovina', BG: 'Bulgaria',
  HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia',
  FI: 'Finland', FR: 'France', GE: 'Georgia', DE: 'Germany', GR: 'Greece',
  HU: 'Hungary', IS: 'Iceland', IL: 'Israel', IT: 'Italy', KZ: 'Kazakhstan',
  XK: 'Kosovo', LV: 'Latvia', LI: 'Liechtenstein', LT: 'Lithuania',
  LU: 'Luxembourg', MT: 'Malta', MD: 'Moldova', MC: 'Monaco', ME: 'Montenegro',
  NL: 'Netherlands', MK: 'North Macedonia', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', IE: 'Ireland', RO: 'Romania', RU: 'Russia', SM: 'San Marino',
  RS: 'Serbia', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
  CH: 'Switzerland', TR: 'Türkiye', UA: 'Ukraine', FO: 'Faroe Islands',
  GI: 'Gibraltar', GB: 'United Kingdom', 'GB-ENG': 'England',
  'GB-SCT': 'Scotland', 'GB-WLS': 'Wales',
  AR: 'Argentina', BO: 'Bolivia', BR: 'Brazil', CL: 'Chile', CO: 'Colombia',
  EC: 'Ecuador', GY: 'Guyana', PY: 'Paraguay', PE: 'Peru', SR: 'Suriname',
  UY: 'Uruguay', VE: 'Venezuela',
  DZ: 'Algeria', AO: 'Angola', BJ: 'Benin', BF: 'Burkina Faso', BI: 'Burundi',
  CM: 'Cameroon', CV: 'Cape Verde', CF: 'Central African Republic', TD: 'Chad',
  KM: 'Comoros', CG: 'Congo', CD: 'DR Congo', CI: 'Côte d’Ivoire', EG: 'Egypt',
  GQ: 'Equatorial Guinea', SZ: 'Eswatini', GA: 'Gabon', GM: 'Gambia',
  GH: 'Ghana', GN: 'Guinea', GW: 'Guinea-Bissau', KE: 'Kenya', LR: 'Liberia',
  LY: 'Libya', MG: 'Madagascar', MW: 'Malawi', ML: 'Mali', MR: 'Mauritania',
  MU: 'Mauritius', MA: 'Morocco', MZ: 'Mozambique', NA: 'Namibia', NE: 'Niger',
  NG: 'Nigeria', RW: 'Rwanda', SN: 'Senegal', SL: 'Sierra Leone', SO: 'Somalia',
  ZA: 'South Africa', SS: 'South Sudan', SD: 'Sudan', TZ: 'Tanzania',
  TG: 'Togo', TN: 'Tunisia', UG: 'Uganda', ZM: 'Zambia', ZW: 'Zimbabwe',
  AF: 'Afghanistan', AU: 'Australia', BH: 'Bahrain', BD: 'Bangladesh',
  KH: 'Cambodia', CN: 'China', HK: 'Hong Kong', IN: 'India', ID: 'Indonesia',
  IR: 'Iran', IQ: 'Iraq', JP: 'Japan', JO: 'Jordan', KR: 'South Korea',
  KP: 'North Korea', KW: 'Kuwait', KG: 'Kyrgyzstan', LB: 'Lebanon',
  MY: 'Malaysia', MN: 'Mongolia', MM: 'Myanmar', NP: 'Nepal', OM: 'Oman',
  PS: 'Palestine', PH: 'Philippines', QA: 'Qatar', SA: 'Saudi Arabia',
  SG: 'Singapore', SY: 'Syria', TJ: 'Tajikistan', TH: 'Thailand',
  TM: 'Turkmenistan', AE: 'UAE', UZ: 'Uzbekistan', VN: 'Vietnam', YE: 'Yemen',
  NZ: 'New Zealand', FJ: 'Fiji', PG: 'Papua New Guinea',
  AG: 'Antigua and Barbuda', AW: 'Aruba', BS: 'Bahamas', BB: 'Barbados',
  BZ: 'Belize', BM: 'Bermuda', CA: 'Canada', KY: 'Cayman Islands',
  CR: 'Costa Rica', CU: 'Cuba', CW: 'Curaçao', DM: 'Dominica',
  DO: 'Dominican Republic', SV: 'El Salvador', GD: 'Grenada', GP: 'Guadeloupe',
  GT: 'Guatemala', HT: 'Haiti', HN: 'Honduras', JM: 'Jamaica',
  MQ: 'Martinique', MX: 'Mexico', MS: 'Montserrat', NI: 'Nicaragua',
  PA: 'Panama', PR: 'Puerto Rico', LC: 'Saint Lucia', KN: 'Saint Kitts and Nevis',
  TT: 'Trinidad and Tobago', US: 'USA',
};

// Russian position bucket -> English (cards.position_ru is stored in Russian).
const POSITION_EN: Record<string, string> = {
  'Вратарь': 'Goalkeeper',
  'Защитник': 'Defender',
  'Полузащитник': 'Midfielder',
  'Нападающий': 'Forward',
};

// Feminine ru forms for women's cards («Полузащитник» reads wrong on a
// woman's card). Вратарь has no separate feminine form.
const POSITION_RU_FEMALE: Record<string, string> = {
  'Защитник': 'Защитница',
  'Полузащитник': 'Полузащитница',
  'Нападающий': 'Нападающая',
};

/** Country name in the interface language. ru/en come from the hand-made
 * maps (they also carry sub-codes like GB-ENG); every other language asks
 * Intl.DisplayNames for its native name and falls back to EN. */
export function countryName(code: string | null | undefined, lang: string): string | null {
  if (!code) return null;
  if (lang.startsWith('ru')) return COUNTRY_NAME_RU[code] ?? code;
  if (!lang.startsWith('en') && !code.includes('-')) {
    try {
      const name = new Intl.DisplayNames([lang.slice(0, 2)], { type: 'region' }).of(code);
      if (name && name !== code) return name;
    } catch { /* very old WebView — fall back to EN */ }
  }
  return COUNTRY_NAME_EN[code] ?? code;
}

/** Position in the interface language; ru keeps the stored value (feminine
 * form on women's cards). */
export function positionName(
  positionRu: string | null | undefined,
  lang: string,
  female = false,
): string | null {
  if (!positionRu) return null;
  if (lang.startsWith('ru')) {
    return female ? (POSITION_RU_FEMALE[positionRu] ?? positionRu) : positionRu;
  }
  return POSITION_EN[positionRu] ?? positionRu;
}
