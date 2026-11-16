export type DoctrineChoiceId = 'a' | 'b' | 'c';

export interface MachiavelliChoice {
  id: DoctrineChoiceId;
  label: string;
  consequence: string;
}

export interface MachiavelliPrinciple {
  id: number;
  title: string;
  source: string;
  idea: string;
  scenario: string;
  choices: MachiavelliChoice[];
  takeaway: string;
}

const ru: MachiavelliPrinciple[] = [
  {
    id: 1, title: 'Смотри на действительность, а не на желаемое',
    source: '«Государь», глава XV',
    idea: 'Макиавелли начинает с verità effettuale — действительной картины вещей. Решение должно опираться на интересы, ресурсы и поведение людей, а не на красивые обещания.',
    scenario: 'Клуб хочет купить звёздного нападающего. Доходы падают, зарплатная ведомость уже перегружена, но болельщики ждут громкого трансфера.',
    choices: [
      { id: 'a', label: 'Сначала получить независимый финансовый и спортивный аудит, затем назвать предел сделки.', consequence: 'Ты отделяешь факт от желания и сохраняешь пространство для решения. Это не гарантирует успех, но не позволяет репутационному давлению заменить расчёт.' },
      { id: 'b', label: 'Попросить финансового директора подготовить несколько сценариев и отложить обещание.', consequence: 'Ты собираешь данные, но пока не задаёшь срок и критерий решения. Неопределённость может усилить давление со стороны агента и трибун.' },
      { id: 'c', label: 'Объявить о трансфере сейчас, рассчитывая, что будущие доходы покроют расходы.', consequence: 'Ты превращаешь надежду в обязательство и рискуешь бюджетом до проверки предпосылок.' },
    ],
    takeaway: 'Первый вопрос правителя — не «как должно быть?», а «что происходит на самом деле и кто чем располагает?».',
  },
  {
    id: 2, title: 'Развивай собственную virtù — способность действовать',
    source: '«Государь», главы VI и XXV',
    idea: 'Virtù у Макиавелли — не просто добродетель. Это энергия, компетентность, расчёт, смелость и способность менять ход событий.',
    scenario: 'Новый владелец клуба полностью зависит от одного влиятельного агента: тот приводит игроков, знает рынок и фактически определяет трансферную политику.',
    choices: [
      { id: 'a', label: 'Передать агенту полный контроль над подбором и переговорами.', consequence: 'Ты экономишь время, но отдаёшь критическое знание и переговорную силу внешнему игроку.' },
      { id: 'b', label: 'Создать собственную систему скаутинга и аналитики, сохранив агента одним из источников рынка.', consequence: 'Ты накапливаешь компетенцию внутри клуба и уменьшаешь зависимость. Результат потребует времени и дисциплины.' },
      { id: 'c', label: 'Нанять независимого специалиста на короткий срок с обязательной передачей знаний команде.', consequence: 'Это промежуточный путь: внешняя экспертиза помогает, но знания постепенно переходят внутрь организации.' },
    ],
    takeaway: 'Сильный руководитель не только использует возможности — он создаёт способность действовать без постоянной опоры на чужую удачу.',
  },
  {
    id: 3, title: 'Опирайся на собственные силы',
    source: '«Государь», главы XII–XIII',
    idea: 'Макиавелли резко критикует наёмные и чужие войска: они могут подвести именно тогда, когда цена зависимости максимальна. В игре это принцип собственных компетенций и контроля.',
    scenario: 'Перед решающим сезоном клуб может купить готовую команду через посредников или укрепить академию, медицинский штаб и собственную селекцию.',
    choices: [
      { id: 'a', label: 'Сочетать внешние приобретения с планом передачи компетенций клубным специалистам.', consequence: 'Ты получаешь скорость и постепенно укрепляешь собственную основу, но должен контролировать конфликт интересов.' },
      { id: 'b', label: 'Полностью передать комплектование состава посредникам.', consequence: 'Краткосрочная скорость покупается потерей контроля, прозрачности и накопления внутреннего знания.' },
      { id: 'c', label: 'Укрепить академию, медицинскую службу и скаутинг, оставив внешние сделки под контролем клуба.', consequence: 'Ты строишь собственную опору. Это медленнее, зато устойчивее к уходу одного агента или инвестора.' },
    ],
    takeaway: 'Не путай доступ к чужому ресурсу с собственной силой. Важнейшие способности должны оставаться внутри династии и клуба.',
  },
  {
    id: 4, title: 'Изучай историю и чужой опыт',
    source: '«Государь», главы VI и XIV',
    idea: 'Макиавелли советует изучать действия выдающихся предшественников и разбирать причины их успехов и поражений.',
    scenario: 'Ты приобрёл клуб, похожий на тот, который другой владелец уже довёл до кризиса: быстрые покупки, конфликт с болельщиками и долги.',
    choices: [
      { id: 'a', label: 'Разобрать чужой опыт, выделить причины провала и проверить, повторяются ли они в твоём клубе.', consequence: 'Ты превращаешь историю в инструмент прогноза, а не в красивую легенду.' },
      { id: 'b', label: 'Повторить модель успешного клуба, не проверяя различия в ресурсах и среде.', consequence: 'Ты копируешь внешнюю форму успеха, игнорируя условия, которые его создали.' },
      { id: 'c', label: 'Выслушать ветеранов клуба и дополнить их память финансовыми и спортивными данными.', consequence: 'Ты получаешь полезный контекст, хотя без проверки воспоминания могут быть выборочными.' },
    ],
    takeaway: 'История полезна не как набор героев для подражания, а как лаборатория причин и последствий.',
  },
  {
    id: 5, title: 'Закрепляй приобретённое, прежде чем расширяться',
    source: '«Государь», главы III и V',
    idea: 'Новые владения особенно уязвимы: старые привычки, интересы и местные порядки не исчезают после смены владельца.',
    scenario: 'Династия купила второй клуб. Местные руководители опасаются закрытия академии, фанаты не доверяют новому владельцу, а сотрудники ждут сокращений.',
    choices: [
      { id: 'a', label: 'Сразу унифицировать всё управление и заменить всех руководителей.', consequence: 'Ты быстро демонстрируешь контроль, но можешь уничтожить местные знания и усилить сопротивление.' },
      { id: 'b', label: 'Сохранить важные местные институты, определить общие правила и договориться о переходном периоде.', consequence: 'Ты снижешь сопротивление и узнаёшь реальную структуру клуба, хотя интеграция займёт больше времени.' },
      { id: 'c', label: 'Оставить всё как есть и не вмешиваться.', consequence: 'Ты избегаешь немедленного конфликта, но не устраняешь противоречия между стратегией владельца и местными интересами.' },
    ],
    takeaway: 'Победа при покупке — начало управления. Устойчивость возникает, когда новые правила принимаются и работают на месте.',
  },
  {
    id: 6, title: 'Понимай интересы разных групп',
    source: '«Государь», главы IX и XIX',
    idea: 'Макиавелли различает интересы народа и элит. Руководитель должен понимать, кто чего хочет и откуда возникает поддержка или сопротивление.',
    scenario: 'Совет директоров требует немедленной прибыли, тренер просит усилить состав, фанаты требуют сохранить местных воспитанников, а игроки хотят ясных перспектив.',
    choices: [
      { id: 'a', label: 'Сосредоточиться только на крупнейшем инвесторе: его голос решает всё.', consequence: 'Ты упрощаешь картину власти и недооцениваешь группы, способные сорвать исполнение решения.' },
      { id: 'b', label: 'Попытаться удовлетворить всех обещаниями без расстановки приоритетов.', consequence: 'Ты временно снижаешь напряжение, но создаёшь несовместимые ожидания.' },
      { id: 'c', label: 'Составить карту интересов, определить красные линии и собрать реалистичную коалицию.', consequence: 'Ты видишь реальное распределение сил и понимаешь, чья поддержка нужна для исполнения плана.' },
    ],
    takeaway: 'Не существует абстрактного «всех». Есть конкретные группы с ресурсами, страхами, ожиданиями и разными возможностями влияния.',
  },
  {
    id: 7, title: 'Уважение надёжнее любви, но страх не должен стать ненавистью',
    source: '«Государь», глава XVII',
    idea: 'Макиавелли считает, что на любовь нельзя полностью положиться, а страх наказания предсказуемее. Но он отдельно предупреждает: правитель должен избегать ненависти.',
    scenario: 'Капитан нарушил дисциплину перед важным матчем. Команда наблюдает, как руководство отреагирует.',
    choices: [
      { id: 'a', label: 'Применить заранее известное правило, выслушать игрока и объяснить решение всей команде.', consequence: 'Ты создаёшь предсказуемое уважение к стандартам, не превращая дисциплину в личную месть.' },
      { id: 'b', label: 'Публично унизить капитана, чтобы остальные боялись повторить поступок.', consequence: 'Страх может дать краткий эффект, но унижение подрывает доверие и провоцирует скрытое сопротивление.' },
      { id: 'c', label: 'Не реагировать, чтобы сохранить дружескую атмосферу.', consequence: 'Ты сохраняешь комфорт сегодня, но показываешь, что правила необязательны.' },
    ],
    takeaway: 'Дисциплина должна быть последовательной и соразмерной. Страх последствий не должен превращаться в ненависть к руководителю.',
  },
  {
    id: 8, title: 'Не вызывай ненависть произволом',
    source: '«Государь», глава XIX',
    idea: 'Для Макиавелли особенно опасны действия, из-за которых люди чувствуют себя ограбленными, униженными или обманутыми.',
    scenario: 'Клуб оказался в финансовом кризисе. Руководство рассматривает сокращение зарплат и пересмотр контрактов.',
    choices: [
      { id: 'a', label: 'Сохранить все условия и надеяться, что кризис закончится сам.', consequence: 'Ты избегаешь немедленного конфликта, но можешь довести клуб до неплатёжеспособности.' },
      { id: 'b', label: 'Открыто показать финансовые данные, предложить законные варианты и распределить нагрузку по прозрачным правилам.', consequence: 'Тяжёлое решение остаётся болезненным, но его причины понятны, а процедура снижает ощущение произвола.' },
      { id: 'c', label: 'Односторонне урезать выплаты и сообщить об этом постфактум.', consequence: 'Ты переносишь цену кризиса на других и создаёшь обоснованное чувство несправедливости.' },
    ],
    takeaway: 'Недовольство решением иногда неизбежно; ненависть часто рождается из произвола, унижения и нарушения базовых ожиданий.',
  },
  {
    id: 9, title: 'Не позволяй считать себя слабым и непоследовательным',
    source: '«Государь», глава XIX',
    idea: 'Презрение к правителю возникает, когда его считают непостоянным, нерешительным или неспособным обеспечить исполнение решений.',
    scenario: 'Тренер и спортивный директор публично перекладывают ответственность друг на друга. Каждый ждёт, что владелец поддержит именно его.',
    choices: [
      { id: 'a', label: 'Дать конфликту продолжаться, чтобы не выбирать сторону.', consequence: 'Ты сохраняешь видимость нейтралитета, но позволяешь другим центрам власти определять повестку.' },
      { id: 'b', label: 'Немедленно уволить обоих без проверки фактов.', consequence: 'Резкость выглядит решительностью, но решение без диагностики может разрушить работающую структуру.' },
      { id: 'c', label: 'Установить факты, разделить зоны ответственности и принять решение с понятными последствиями.', consequence: 'Ты демонстрируешь контроль над процессом и не подменяешь решительность импульсивностью.' },
    ],
    takeaway: 'Решительность — это не скорость любой ценой. Это способность принять проверенное решение и обеспечить его исполнение.',
  },
  {
    id: 10, title: 'Будь и львом, и лисой',
    source: '«Государь», глава XVIII',
    idea: 'Лев символизирует силу, лиса — распознавание ловушек. Одной силы недостаточно против хитрости, а одной хитрости — против открытого давления.',
    scenario: 'Агент на переговорах заявляет, что у игрока есть более выгодное предложение конкурента, но отказывается раскрыть детали.',
    choices: [
      { id: 'a', label: 'Проверить информацию, определить предел сделки и быть готовым отказаться, сохраняя законные рычаги переговоров.', consequence: 'Ты соединяешь проверку, альтернативы и твёрдость без угроз и обмана.' },
      { id: 'b', label: 'Принять слова агента на веру, чтобы не потерять игрока.', consequence: 'Ты позволяешь другой стороне управлять срочностью и информацией.' },
      { id: 'c', label: 'Ответить угрозами и публичным давлением.', consequence: 'Ты показываешь силу, но можешь превратить переговоры в конфликт и потерять пространство для соглашения.' },
    ],
    takeaway: 'Сначала распознай ловушку и скрытые стимулы; затем прояви твёрдость там, где это действительно необходимо.',
  },
  {
    id: 11, title: 'Управляй репутацией через поступки и ясные сигналы',
    source: '«Государь», главы XVIII и XXI',
    idea: 'Макиавелли уделяет большое внимание тому, как действия выглядят для окружающих. Репутация влияет на доверие, союзы и готовность следовать за лидером.',
    scenario: 'После двух неудачных сезонов клуб объявляет новую стратегию. Болельщики уже слышали несколько громких обещаний.',
    choices: [
      { id: 'a', label: 'Запустить масштабную рекламную кампанию до появления измеримых изменений.', consequence: 'Ты повышаешь внимание, но усиливаешь разрыв между образом и реальностью.' },
      { id: 'b', label: 'Опубликовать проверяемые цели, первые конкретные действия и регулярный отчёт о прогрессе.', consequence: 'Ты связываешь репутацию с наблюдаемыми поступками и создаёшь возможность проверить обещания.' },
      { id: 'c', label: 'Ничего не объяснять: результаты когда-нибудь скажут сами за себя.', consequence: 'Ты избегаешь громких слов, но оставляешь информационное поле слухам и чужим интерпретациям.' },
    ],
    takeaway: 'Образ важен, но он устойчив только тогда, когда за ним стоят поступки, которые можно проверить.',
  },
  {
    id: 12, title: 'Не раздавай обещания, которыми не управляешь',
    source: '«Государь», глава XVIII',
    idea: 'Макиавелли анализирует политическую цену обещаний и обстоятельства, при которых обязательства сталкиваются с изменившейся реальностью. Это не оправдание мелкого обмана.',
    scenario: 'Ты обещал капитану новый контракт, но после медицинского обследования и пересмотра бюджета прежние условия стали невыполнимыми.',
    choices: [
      { id: 'a', label: 'Сделать вид, что обещания не было, и затянуть переговоры.', consequence: 'Ты избегаешь разговора сейчас, но разрушаешь доверие и создаёшь конфликт.' },
      { id: 'b', label: 'Подписать заведомо невыгодный контракт ради сохранения слова любой ценой.', consequence: 'Ты сохраняешь буквальное обещание, но можешь поставить под угрозу устойчивость клуба.' },
      { id: 'c', label: 'Объяснить новые факты, признать прежнее обязательство и предложить честный пересмотр условий.', consequence: 'Ты сохраняешь ответственность за слова и адаптируешь решение к обстоятельствам через переговоры.' },
    ],
    takeaway: 'Мудрость не в том, чтобы обещать всё или нарушать обещания без последствий, а в том, чтобы понимать цену обязательств до их принятия.',
  },
  {
    id: 13, title: 'Выбирай советников по компетентности',
    source: '«Государь», глава XXII',
    idea: 'Качество ближайших помощников отражает способность правителя судить о людях. Сильный руководитель выбирает профессионалов и понимает их стимулы.',
    scenario: 'На должность спортивного директора претендуют давний друг семьи, известный специалист и кандидат с сильными связями, но слабой репутацией.',
    choices: [
      { id: 'a', label: 'Сравнить кандидатов по компетенциям, конфликтам интересов, результатам и условиям ответственности.', consequence: 'Ты выбираешь на основании работы и стимулов, а не близости или блеска имени.' },
      { id: 'b', label: 'Назначить друга семьи: ему можно доверять лично.', consequence: 'Личная близость не доказывает профессиональную пригодность и может размыть ответственность.' },
      { id: 'c', label: 'Назначить самого известного кандидата без проверки его прошлых решений.', consequence: 'Ты покупаешь репутацию имени, но не проверяешь качество управления.' },
    ],
    takeaway: 'Советник усиливает правителя только тогда, когда его компетентность проверена, а ответственность определена.',
  },
  {
    id: 14, title: 'Создай пространство для неприятной правды',
    source: '«Государь», глава XXIII',
    idea: 'Макиавелли предупреждает о льстецах: правитель, который слышит только приятное, теряет связь с действительностью.',
    scenario: 'Все руководители клуба поддерживают твой план расширения стадиона. Один финансовый аналитик предупреждает, что прогноз посещаемости завышен.',
    choices: [
      { id: 'a', label: 'Игнорировать аналитика: несогласие подрывает единство команды.', consequence: 'Ты защищаешь комфорт руководителя, но отрезаешь себя от важного сигнала.' },
      { id: 'b', label: 'Дать аналитику защищённый канал для возражений и потребовать проверить его расчёты.', consequence: 'Ты допускаешь несогласие, не превращая его автоматически в истину: аргументы проходят проверку.' },
      { id: 'c', label: 'Передать все решения на голосование сотрудников.', consequence: 'Ты расширяешь участие, но размываешь ответственность и не гарантируешь качество анализа.' },
    ],
    takeaway: 'Хороший совет — не тот, который приятен. Это проверяемая информация, которую можно безопасно принести руководителю.',
  },
  {
    id: 15, title: 'Сдерживай щедрость, которая разрушает основу',
    source: '«Государь», глава XVI',
    idea: 'Макиавелли показывает, что показная щедрость может привести к долгам и новым сборам. Финансовая осторожность иногда лучше эффектного жеста.',
    scenario: 'После победы в кубке владельцы хотят выплатить огромные премии и немедленно подписать трёх дорогих игроков.',
    choices: [
      { id: 'a', label: 'Потратить весь резерв: успех нужно отпраздновать и закрепить громкими покупками.', consequence: 'Ты получаешь краткий восторг, но оставляешь клуб без защиты от неудачного сезона.' },
      { id: 'b', label: 'Заморозить все расходы и отказаться от любых инвестиций.', consequence: 'Ты сохраняешь деньги, но рискуешь упустить момент для разумного развития.' },
      { id: 'c', label: 'Установить предел премий, сохранить резерв и инвестировать только в подтверждённые потребности.', consequence: 'Ты превращаешь успех в ресурс для долгосрочного развития, не путая щедрость с демонстративной растратой.' },
    ],
    takeaway: 'Финансовая дисциплина — не жадность. Это защита будущей свободы действий.',
  },
  {
    id: 16, title: 'Готовься к конфликту до того, как он станет кризисом',
    source: '«Государь», главы XII–XIV',
    idea: 'Для Макиавелли подготовка к угрозам — постоянная обязанность руководителя. Нельзя вспоминать о защите только в момент опасности.',
    scenario: 'Клуб входит в сезон с короткой скамейкой, слабой медицинской инфраструктурой и отсутствием плана на случай травм ключевых игроков.',
    choices: [
      { id: 'a', label: 'Заранее оценить уязвимости, подготовить глубину состава и сценарии на случай травм.', consequence: 'Ты уменьшаешь вероятность того, что один неожиданный удар разрушит весь сезон.' },
      { id: 'b', label: 'Решать проблемы только после того, как травмы или кризис уже произошли.', consequence: 'Ты экономишь ресурсы сейчас, но платишь за отсутствие подготовки в самый дорогой момент.' },
      { id: 'c', label: 'Купить как можно больше игроков без оценки ролей и бюджета.', consequence: 'Ты реагируешь на риск количеством, но можешь создать новые финансовые и командные проблемы.' },
    ],
    takeaway: 'Стратегия — это не только план победы. Это готовность к моменту, когда план перестанет работать.',
  },
  {
    id: 17, title: 'Выбирай союзы осознанно, а не ради видимости нейтралитета',
    source: '«Государь», глава XXI',
    idea: 'Макиавелли разбирает, как нейтралитет и выбор стороны влияют на репутацию и безопасность правителя. У каждого союза есть цена и последствия.',
    scenario: 'Перед реформой лиги два влиятельных клуба формируют конкурирующие коалиции. Твой клуб может повлиять на исход голосования.',
    choices: [
      { id: 'a', label: 'Не участвовать ни в одной коалиции и не объяснять свою позицию.', consequence: 'Ты сохраняешь дистанцию, но можешь потерять влияние и вызвать недоверие обеих сторон.' },
      { id: 'b', label: 'Сравнить интересы коалиций, согласовать условия и публично обозначить пределы союза.', consequence: 'Ты выбираешь позицию осознанно и сохраняешь возможность оценить, выполняет ли союз свои обязательства.' },
      { id: 'c', label: 'Безусловно поддержать самую сильную сторону.', consequence: 'Ты получаешь краткосрочный доступ к победителю, но становишься зависимым от его повестки.' },
    ],
    takeaway: 'Союз — это обмен обязательствами. Важно понимать, что ты получаешь, чем рискуешь и где проходит граница зависимости.',
  },
  {
    id: 18, title: 'Приспосабливайся к переменам и готовься к fortuna',
    source: '«Государь», глава XXV',
    idea: 'Fortuna — изменчивость обстоятельств. Часть событий неподконтрольна человеку, но подготовка, запас прочности и гибкость уменьшают их разрушительную силу.',
    scenario: 'Правила финансового контроля лиги меняются, главный спонсор уходит, а молодые клубы начинают быстрее развивать игроков благодаря аналитике.',
    choices: [
      { id: 'a', label: 'Сохранить прежний план: последовательность важнее перемен.', consequence: 'Последовательность становится инерцией, если условия уже изменились.' },
      { id: 'b', label: 'Менять стратегию каждую неделю, реагируя на последние новости.', consequence: 'Ты реагируешь быстро, но теряешь направление и способность оценивать результаты.' },
      { id: 'c', label: 'Пересмотреть сценарии, сохранить долгосрочную цель и изменить средства с учётом новых фактов.', consequence: 'Ты адаптируешь способ действия, не отказываясь от стратегического направления.' },
    ],
    takeaway: 'Нельзя управлять удачей, но можно подготовить организацию к её поворотам. Гибкость — часть силы, а не отказ от принципов.',
  },
];

const en: MachiavelliPrinciple[] = [
  {
    id: 1, title: 'See reality, not the reality you wish for',
    source: 'The Prince, Chapter XV',
    idea: 'Machiavelli begins with verità effettuale — the effective truth of things. Decisions must rest on interests, resources and behaviour, not attractive promises.',
    scenario: 'Your club wants a star striker. Revenue is falling and the wage bill is already stretched, but supporters expect a major signing.',
    choices: [
      { id: 'a', label: 'Commission an independent financial and sporting audit, then set a deal ceiling.', consequence: 'You separate facts from desire and preserve room to decide. This does not guarantee success, but stops public pressure replacing analysis.' },
      { id: 'b', label: 'Ask the finance director for scenarios and delay making a promise.', consequence: 'You gather evidence but set no deadline or decision rule. Uncertainty may increase pressure from the agent and supporters.' },
      { id: 'c', label: 'Announce the signing now and assume future revenue will cover the cost.', consequence: 'You turn hope into a commitment and expose the budget before testing the assumptions.' },
    ],
    takeaway: 'The first question of a ruler is not “what should be true?” but “what is happening, and who controls which resources?”',
  },
  {
    id: 2, title: 'Develop your own virtù — the capacity to act',
    source: 'The Prince, Chapters VI and XXV',
    idea: 'For Machiavelli, virtù is not simply moral virtue. It is energy, competence, judgment, courage and the ability to shape events.',
    scenario: 'A new owner depends entirely on one powerful agent who supplies players, knows the market and effectively controls recruitment.',
    choices: [
      { id: 'a', label: 'Give the agent full control of scouting and negotiations.', consequence: 'You save time but surrender critical knowledge and bargaining power to an outside actor.' },
      { id: 'b', label: 'Build internal scouting and analytics while keeping the agent as one market source.', consequence: 'You accumulate in-house capability and reduce dependency. Results require time and discipline.' },
      { id: 'c', label: 'Hire an independent specialist short-term with mandatory knowledge transfer.', consequence: 'This is a transitional route: external expertise helps while knowledge gradually moves inside the club.' },
    ],
    takeaway: 'A strong leader does not merely exploit opportunities; they build the capacity to act without relying on someone else’s luck.',
  },
  {
    id: 3, title: 'Rely on your own foundations',
    source: 'The Prince, Chapters XII–XIII',
    idea: 'Machiavelli criticises mercenary and auxiliary forces because they may fail when dependence is most costly. In the game, this means owning critical capabilities and control.',
    scenario: 'Before a decisive season, the club can buy a ready-made team through intermediaries or strengthen its academy, medical staff and recruitment system.',
    choices: [
      { id: 'a', label: 'Combine external signings with a plan to transfer expertise to club staff.', consequence: 'You gain speed while strengthening your foundations, but must manage conflicts of interest.' },
      { id: 'b', label: 'Hand squad building entirely to intermediaries.', consequence: 'Short-term speed is purchased at the cost of control, transparency and institutional learning.' },
      { id: 'c', label: 'Strengthen the academy, medical department and scouting; keep deals under club control.', consequence: 'You build your own foundation. It is slower, but less vulnerable to one agent or investor leaving.' },
    ],
    takeaway: 'Access to someone else’s resources is not the same as having strength of your own. Critical capabilities should stay within the club and dynasty.',
  },
  {
    id: 4, title: 'Study history and the experience of others',
    source: 'The Prince, Chapters VI and XIV',
    idea: 'Machiavelli advises studying exceptional predecessors and examining the causes of their successes and failures.',
    scenario: 'You acquired a club resembling one another owner drove into crisis through rapid spending, supporter conflict and debt.',
    choices: [
      { id: 'a', label: 'Study the failed takeover, isolate its causes and test whether they apply to your club.', consequence: 'You turn history into a forecasting tool rather than a heroic story.' },
      { id: 'b', label: 'Copy a successful club’s model without checking differences in resources and context.', consequence: 'You copy the visible form of success while ignoring the conditions that produced it.' },
      { id: 'c', label: 'Listen to club veterans and compare their memories with financial and sporting data.', consequence: 'You gain useful context, though memories may be selective unless checked.' },
    ],
    takeaway: 'History is useful not as a gallery of heroes, but as a laboratory of causes and consequences.',
  },
  {
    id: 5, title: 'Consolidate an acquisition before expanding',
    source: 'The Prince, Chapters III and V',
    idea: 'Newly acquired territories are especially fragile: old habits, interests and institutions do not disappear when ownership changes.',
    scenario: 'Your dynasty bought a second club. Local leaders fear the academy will close, supporters distrust the new owner and staff expect layoffs.',
    choices: [
      { id: 'a', label: 'Standardise everything immediately and replace all local leaders.', consequence: 'You demonstrate control quickly but may destroy local knowledge and intensify resistance.' },
      { id: 'b', label: 'Preserve valuable local institutions, define common rules and agree on a transition period.', consequence: 'You reduce resistance and learn how the club really works, although integration takes longer.' },
      { id: 'c', label: 'Leave everything untouched and avoid intervention.', consequence: 'You avoid immediate conflict but do not resolve the gap between owner strategy and local interests.' },
    ],
    takeaway: 'Winning the acquisition is the beginning of management. Stability comes when new rules are accepted and work locally.',
  },
  {
    id: 6, title: 'Understand the interests of different groups',
    source: 'The Prince, Chapters IX and XIX',
    idea: 'Machiavelli distinguishes the interests of the people from those of elites. A ruler must understand who wants what and where support or resistance comes from.',
    scenario: 'The board wants immediate profit, the coach wants reinforcements, supporters want local academy graduates and players want clear prospects.',
    choices: [
      { id: 'a', label: 'Focus only on the largest investor: their vote decides everything.', consequence: 'You simplify the power map and underestimate groups capable of blocking implementation.' },
      { id: 'b', label: 'Promise to satisfy everyone without setting priorities.', consequence: 'You reduce tension briefly but create incompatible expectations.' },
      { id: 'c', label: 'Map interests, define red lines and build a realistic coalition.', consequence: 'You see the real distribution of power and identify whose support implementation requires.' },
    ],
    takeaway: 'There is no abstract “everyone”. There are specific groups with resources, fears, expectations and different forms of influence.',
  },
  {
    id: 7, title: 'Respect is more reliable than love; fear must not become hatred',
    source: 'The Prince, Chapter XVII',
    idea: 'Machiavelli argues that love is difficult to rely on while fear of consequences is more predictable. But he explicitly warns rulers to avoid hatred.',
    scenario: 'The captain breaks discipline before an important match. The whole squad is watching the club’s response.',
    choices: [
      { id: 'a', label: 'Apply a known rule, hear the player and explain the decision to the squad.', consequence: 'You build predictable respect for standards without turning discipline into personal revenge.' },
      { id: 'b', label: 'Humiliate the captain publicly so everyone is afraid to repeat the act.', consequence: 'Fear may work briefly, but humiliation damages trust and encourages hidden resistance.' },
      { id: 'c', label: 'Ignore the incident to preserve a friendly atmosphere.', consequence: 'You preserve comfort today but signal that rules are optional.' },
    ],
    takeaway: 'Discipline should be consistent and proportionate. Fear of consequences must not turn into hatred of the leader.',
  },
  {
    id: 8, title: 'Do not create hatred through arbitrariness',
    source: 'The Prince, Chapter XIX',
    idea: 'For Machiavelli, actions that make people feel robbed, humiliated or deceived are especially dangerous.',
    scenario: 'The club is in financial crisis. Management is considering wage reductions and contract changes.',
    choices: [
      { id: 'a', label: 'Keep every term unchanged and hope the crisis passes.', consequence: 'You avoid immediate conflict but may push the club toward insolvency.' },
      { id: 'b', label: 'Show the financial facts, offer lawful options and distribute the burden transparently.', consequence: 'The decision remains painful, but its reasons are visible and fair process reduces arbitrariness.' },
      { id: 'c', label: 'Cut payments unilaterally and tell people after the fact.', consequence: 'You shift the crisis cost onto others and create a justified sense of injustice.' },
    ],
    takeaway: 'Disagreement with a decision may be unavoidable; hatred often grows from arbitrariness, humiliation and broken basic expectations.',
  },
  {
    id: 9, title: 'Do not let others see you as weak or inconsistent',
    source: 'The Prince, Chapter XIX',
    idea: 'Contempt grows when a ruler is seen as unstable, indecisive or unable to make decisions stick.',
    scenario: 'The coach and sporting director publicly blame each other. Both expect the owner to take their side.',
    choices: [
      { id: 'a', label: 'Let the conflict continue so you do not have to choose.', consequence: 'You preserve the appearance of neutrality but let other power centres set the agenda.' },
      { id: 'b', label: 'Dismiss both immediately without checking the facts.', consequence: 'Harshness may look decisive, but an untested decision can destroy a functioning structure.' },
      { id: 'c', label: 'Establish the facts, define responsibilities and make a decision with clear consequences.', consequence: 'You demonstrate control of the process without confusing decisiveness with impulse.' },
    ],
    takeaway: 'Decisiveness is not speed at any cost. It is the ability to make an informed decision and ensure it is carried out.',
  },
  {
    id: 10, title: 'Be both lion and fox',
    source: 'The Prince, Chapter XVIII',
    idea: 'The lion represents strength; the fox recognises traps. Strength alone cannot defeat cunning, and cunning alone cannot withstand open pressure.',
    scenario: 'An agent says the player has a better offer from a rival but refuses to share details.',
    choices: [
      { id: 'a', label: 'Verify the claim, set a deal limit and be ready to walk away while preserving lawful leverage.', consequence: 'You combine verification, alternatives and firmness without threats or deception.' },
      { id: 'b', label: 'Take the agent at their word so you do not lose the player.', consequence: 'You allow the other side to control urgency and information.' },
      { id: 'c', label: 'Respond with threats and public pressure.', consequence: 'You signal strength but may turn negotiation into conflict and lose room for agreement.' },
    ],
    takeaway: 'Recognise the trap and hidden incentives first; then use firmness where it is genuinely needed.',
  },
  {
    id: 11, title: 'Manage reputation through actions and clear signals',
    source: 'The Prince, Chapters XVIII and XXI',
    idea: 'Machiavelli pays close attention to how actions appear to others. Reputation affects trust, alliances and willingness to follow a leader.',
    scenario: 'After two poor seasons, the club announces a new strategy. Supporters have already heard several grand promises.',
    choices: [
      { id: 'a', label: 'Launch a major publicity campaign before measurable changes exist.', consequence: 'You raise attention but widen the gap between image and reality.' },
      { id: 'b', label: 'Publish verifiable goals, concrete first actions and regular progress reports.', consequence: 'You tie reputation to observable actions and make promises testable.' },
      { id: 'c', label: 'Explain nothing: results will eventually speak for themselves.', consequence: 'You avoid grand words but leave the information space to rumours and others’ interpretations.' },
    ],
    takeaway: 'Image matters, but it lasts only when backed by actions that can be checked.',
  },
  {
    id: 12, title: 'Do not make promises you cannot control',
    source: 'The Prince, Chapter XVIII',
    idea: 'Machiavelli examines the political cost of promises and circumstances in which commitments collide with changed realities. This is not a licence for casual dishonesty.',
    scenario: 'You promised the captain a new contract, but a medical review and revised budget make the original terms impossible.',
    choices: [
      { id: 'a', label: 'Pretend the promise never happened and delay the talks.', consequence: 'You avoid the conversation now but damage trust and create conflict.' },
      { id: 'b', label: 'Sign a knowingly unsustainable contract to keep your word at any cost.', consequence: 'You preserve the literal promise but may endanger the club’s stability.' },
      { id: 'c', label: 'Explain the new facts, acknowledge the commitment and negotiate a transparent revision.', consequence: 'You remain accountable for your words while adapting through negotiation.' },
    ],
    takeaway: 'Wisdom is neither promising everything nor breaking promises without consequence; it is understanding the cost before making them.',
  },
  {
    id: 13, title: 'Choose advisers for competence',
    source: 'The Prince, Chapter XXII',
    idea: 'The quality of a ruler’s closest assistants reflects their judgment of people. Strong leaders choose professionals and understand their incentives.',
    scenario: 'Candidates for sporting director include a family friend, a respected specialist and a well-connected candidate with a weak record.',
    choices: [
      { id: 'a', label: 'Compare competence, conflicts of interest, track records and accountability.', consequence: 'You choose on work and incentives, not closeness or a famous name.' },
      { id: 'b', label: 'Appoint the family friend because you personally trust them.', consequence: 'Personal closeness does not prove professional ability and may blur accountability.' },
      { id: 'c', label: 'Appoint the most famous candidate without checking past decisions.', consequence: 'You buy name recognition without testing management quality.' },
    ],
    takeaway: 'An adviser strengthens a ruler only when competence is tested and responsibility is defined.',
  },
  {
    id: 14, title: 'Create room for unwelcome truth',
    source: 'The Prince, Chapter XXIII',
    idea: 'Machiavelli warns against flatterers: a ruler who hears only pleasant things loses contact with reality.',
    scenario: 'Every club executive supports your stadium expansion. One financial analyst warns that the attendance forecast is overstated.',
    choices: [
      { id: 'a', label: 'Ignore the analyst: disagreement weakens the team.', consequence: 'You protect the leader’s comfort but cut off an important signal.' },
      { id: 'b', label: 'Give the analyst a protected channel to challenge the plan and test the calculations.', consequence: 'You permit dissent without treating it as automatically correct: arguments are checked.' },
      { id: 'c', label: 'Put every decision to a staff vote.', consequence: 'You broaden participation but dilute accountability and do not guarantee sound analysis.' },
    ],
    takeaway: 'Good advice is not advice that feels pleasant. It is verifiable information that can safely reach the decision-maker.',
  },
  {
    id: 15, title: 'Restrain generosity that destroys the foundation',
    source: 'The Prince, Chapter XVI',
    idea: 'Machiavelli shows how showy generosity can create debt and new levies. Financial restraint can be wiser than an impressive gesture.',
    scenario: 'After winning the cup, the owners want huge bonuses and three expensive signings immediately.',
    choices: [
      { id: 'a', label: 'Spend the entire reserve: success must be celebrated with major purchases.', consequence: 'You create short-term excitement but leave the club exposed to a bad season.' },
      { id: 'b', label: 'Freeze all spending and refuse every investment.', consequence: 'You preserve cash but may miss the moment for sensible development.' },
      { id: 'c', label: 'Set a bonus ceiling, preserve reserves and invest only in proven needs.', consequence: 'You turn success into a resource for long-term development rather than showy waste.' },
    ],
    takeaway: 'Financial discipline is not stinginess. It protects future freedom of action.',
  },
  {
    id: 16, title: 'Prepare for conflict before it becomes a crisis',
    source: 'The Prince, Chapters XII–XIV',
    idea: 'For Machiavelli, preparation against threats is a permanent duty of leadership. Protection cannot begin only when danger arrives.',
    scenario: 'The club starts the season with a thin squad, weak medical infrastructure and no injury contingency plan.',
    choices: [
      { id: 'a', label: 'Assess vulnerabilities early, build squad depth and prepare injury scenarios.', consequence: 'You reduce the chance that one unexpected shock destroys the season.' },
      { id: 'b', label: 'Address problems only after injuries or a crisis occur.', consequence: 'You save resources now but pay for the lack of preparation at the most expensive moment.' },
      { id: 'c', label: 'Buy as many players as possible without assessing roles or budget.', consequence: 'You answer risk with volume but may create new financial and team problems.' },
    ],
    takeaway: 'Strategy is not only a plan to win. It is readiness for the moment when the plan stops working.',
  },
  {
    id: 17, title: 'Choose alliances deliberately, not for the appearance of neutrality',
    source: 'The Prince, Chapter XXI',
    idea: 'Machiavelli examines how neutrality and taking sides affect a ruler’s reputation and security. Every alliance has a price and consequences.',
    scenario: 'Before a league reform, two influential clubs form rival coalitions. Your club can affect the vote.',
    choices: [
      { id: 'a', label: 'Join neither coalition and explain no position.', consequence: 'You keep your distance but may lose influence and invite distrust from both sides.' },
      { id: 'b', label: 'Compare coalition interests, negotiate terms and state the limits of the alliance.', consequence: 'You choose deliberately and retain a way to judge whether the alliance honours its commitments.' },
      { id: 'c', label: 'Unconditionally support the strongest side.', consequence: 'You gain short-term access to the likely winner but become dependent on its agenda.' },
    ],
    takeaway: 'An alliance is an exchange of commitments. Know what you gain, what you risk and where dependence begins.',
  },
  {
    id: 18, title: 'Adapt to change and prepare for fortuna',
    source: 'The Prince, Chapter XXV',
    idea: 'Fortuna is the volatility of circumstances. Some events are beyond control, but preparation, reserves and flexibility reduce their destructive force.',
    scenario: 'League financial rules change, the main sponsor leaves and younger clubs develop players faster through analytics.',
    choices: [
      { id: 'a', label: 'Keep the old plan: consistency matters more than change.', consequence: 'Consistency becomes inertia when the conditions have changed.' },
      { id: 'b', label: 'Change strategy every week in response to the latest news.', consequence: 'You react quickly but lose direction and the ability to evaluate results.' },
      { id: 'c', label: 'Reassess scenarios, preserve the long-term goal and adapt the means to new evidence.', consequence: 'You change how you act without abandoning the strategic direction.' },
    ],
    takeaway: 'You cannot control fortune, but you can prepare the organisation for its turns. Flexibility is part of strength, not a rejection of principles.',
  },
];

export const machiavelliPrinciples: Record<'ru' | 'en', MachiavelliPrinciple[]> = { ru, en };
