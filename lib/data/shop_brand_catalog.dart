enum ShopBrandTab { popular, luxe, onlyAtBaylen, newLaunches }

class ShopBrandCatalog {
  static const tabLabels = {
    ShopBrandTab.popular: 'POPULAR',
    ShopBrandTab.luxe: 'LUXE',
    ShopBrandTab.onlyAtBaylen: 'ONLY AT BAYLEN',
    ShopBrandTab.newLaunches: 'NEW LAUNCHES',
  };

  static const popular = [
    'Baylen Cosmetics',
    'DOT & KEY',
    'Kay Beauty',
    'MAYBELLINE NEW YORK',
    'LAKMÉ',
    'L\'ORÉAL PROFESSIONNEL PARIS',
    'MAC',
    'plum',
    'Cetaphil',
    'Pyunkang Yul',
    'L\'ORÉAL PARIS',
    'e.l.f.',
    'The Ordinary',
    'Charlotte Tilbury',
    'LANEIGE',
    'BEAUTY OF JOSEON',
    'innisfree',
    'YVES SAINT LAURENT',
    'KÉRASTASE PARIS',
    'Dove',
    'love beauty & planet',
    'Bath & Body Works',
    'VICTORIA\'S SECRET',
    'Neutrogena',
    'CeraVe',
    'ESTĒE LAUDER',
  ];

  static const luxe = [
    'SK-II',
    'Rare Beauty',
    'Milk Makeup',
    'CHANEL',
    'OLAPLEX',
    'MAC',
    'hudabeauty',
    'ESTĒE LAUDER',
    'KAMA AYURVEDA',
    'CLINIQUE',
    'FOREST ESSENTIALS',
    'BOBBI BROWN',
    'smashbox',
    'LANEIGE',
    'LANCÔME PARIS',
    'Too Faced',
    'Charlotte Tilbury',
    'YVES SAINT LAURENT',
    'ghd',
    'DIOR',
    'CAUDALIE PARIS',
    'KÉRASTASE PARIS',
    'JO MALONE LONDON',
    'SOL DE JANEIRO',
  ];

  static const onlyAtBaylen = [
    'MORPHE',
    'LA ROCHE POSAY',
    'Charlotte Tilbury',
    'NYX PROFESSIONAL MAKEUP',
    'e.l.f.',
    'pixi',
    'SK-II',
    'Murad',
    'PAT McGRATH LABS',
    'TANGLE TEEZER',
    'Kiehl\'s',
    'Baylen Cosmetics',
    'Baylen Wanderlust',
    'COLOURPOP',
    'CHANEL',
    'Anua',
    'Supergoop!',
    'AESTURA',
    'Eucerin',
    'URBAN DECAY',
    'Baylen Skin',
    'Baylen Hair',
    'Baylen Tools',
  ];

  static const newLaunches = [
    'Rare Beauty',
    'MORPHE',
    'Milk Makeup',
    'Anua',
    'CHANTECAILLE',
    'GIORGIO ARMANI',
    'NEXXUS',
    'Pyunkang Yul',
    'KORA ORGANICS',
    'PAULA\'S CHOICE',
    'AESTURA',
    'MANETRAIN',
    'beautyblender',
    'Biodance',
    'HIBISCUS MONKEY',
    'LOVETC',
    'mixsoon',
    'Supergoop!',
    'SACHAJUAN',
    'medicube',
    'd\'Alba',
    'ROUND LAB',
    'Dr. Althea',
  ];

  static List<String> namesFor(ShopBrandTab tab) {
    switch (tab) {
      case ShopBrandTab.popular:
        return popular;
      case ShopBrandTab.luxe:
        return luxe;
      case ShopBrandTab.onlyAtBaylen:
        return onlyAtBaylen;
      case ShopBrandTab.newLaunches:
        return newLaunches;
    }
  }

  static List<String> allNames() {
    final seen = <String>{};
    final names = <String>[];
    for (final name in [
      ...popular,
      ...luxe,
      ...onlyAtBaylen,
      ...newLaunches,
    ]) {
      final key = normalize(name);
      if (seen.add(key)) {
        names.add(name);
      }
    }
    names.sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return names;
  }

  static String displayName(String name) {
    return name.replaceAll(RegExp('nykaa', caseSensitive: false), 'Baylen');
  }

  static String normalize(String name) {
    var value = displayName(name).toLowerCase().trim();
    const accents = {
      'é': 'e',
      'è': 'e',
      'ê': 'e',
      'ë': 'e',
      'ē': 'e',
      'á': 'a',
      'à': 'a',
      'â': 'a',
      'ó': 'o',
      'ô': 'o',
      'í': 'i',
      'ú': 'u',
      'ü': 'u',
      'ç': 'c',
      'ñ': 'n',
      '·': '',
    };
    accents.forEach((from, to) {
      value = value.replaceAll(from, to);
    });
    return value.replaceAll(RegExp(r'[^a-z0-9]'), '');
  }

  static String letterOf(String name) {
    final cleaned = displayName(name).replaceAll(RegExp(r'[^A-Za-z]'), '');
    if (cleaned.isEmpty) {
      return '#';
    }
    return cleaned[0].toUpperCase();
  }
}
