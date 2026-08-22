class AuthUser {
  const AuthUser({
    required this.userId,
    required this.email,
    required this.firstName,
    required this.lastName,
  });

  final String userId;
  final String email;
  final String firstName;
  final String lastName;

  String get displayName {
    final name = '$firstName $lastName'.trim();
    return name.isEmpty ? email : name;
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      userId: json['user_id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
    );
  }
}
