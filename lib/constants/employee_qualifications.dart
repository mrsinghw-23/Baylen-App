/// Shared employee qualification options for registration and KYC.
const kEmployeeQualificationOptions = [
  '10th Pass',
  'Intermediate',
  'Diploma',
  'Graduation',
  'Post Graduation',
  'Other',
];

/// Maps saved/free-text values to a dropdown-safe label.
String? normalizeEmployeeQualification(String? raw) {
  if (raw == null || raw.trim().isEmpty) return null;
  final value = raw.trim();
  final lower = value.toLowerCase();

  for (final option in kEmployeeQualificationOptions) {
    if (option.toLowerCase() == lower) return option;
  }

  switch (lower) {
    case '10th':
    case '10':
      return '10th Pass';
    case '12th':
    case '12':
    case '12th pass':
      return 'Intermediate';
    case 'intermediate':
      return 'Intermediate';
    case 'graduation':
    case 'graduate':
      return 'Graduation';
    case 'post graduation':
    case 'postgraduate':
    case 'pg':
      return 'Post Graduation';
    case 'diploma':
      return 'Diploma';
    default:
      return value;
  }
}

/// Dropdown [value] — null when empty or invalid (prevents Flutter assertion crash).
String? employeeQualificationDropdownValue(String? raw) {
  final normalized = normalizeEmployeeQualification(raw);
  if (normalized == null || normalized.isEmpty) return null;
  final options = employeeQualificationDropdownOptions(raw);
  return options.contains(normalized) ? normalized : null;
}

/// Dropdown items — includes the current saved value when it is not in the preset list.
List<String> employeeQualificationDropdownOptions(String? raw) {
  final normalized = normalizeEmployeeQualification(raw);
  if (normalized == null ||
      normalized.isEmpty ||
      kEmployeeQualificationOptions.contains(normalized)) {
    return kEmployeeQualificationOptions;
  }
  return [...kEmployeeQualificationOptions, normalized];
}
