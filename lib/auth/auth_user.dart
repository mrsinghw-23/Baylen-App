class AuthUser {
  const AuthUser({
    required this.userId,
    required this.email,
    required this.mobile,
    required this.firstName,
    required this.lastName,
    this.gender = '',
    this.dateOfBirth = '',
    this.isProfileComplete = false,
  });

  final String userId;
  final String email;
  final String mobile;
  final String firstName;
  final String lastName;
  final String gender;
  final String dateOfBirth;
  final bool isProfileComplete;

  String get displayName {
    final name = '$firstName $lastName'.trim();
    if (name.isNotEmpty) {
      return name;
    }
    return email.isNotEmpty ? email : mobile;
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    final email = json['email']?.toString() ?? '';
    final firstName = json['first_name']?.toString() ?? '';
    final lastName = json['last_name']?.toString() ?? '';
    final isComplete =
        json['is_profile_complete'] == true ||
        (firstName.trim().length >= 2 &&
            lastName.trim().isNotEmpty &&
            email.trim().isNotEmpty &&
            !email.contains('.local'));

    return AuthUser(
      userId: json['user_id']?.toString() ?? '',
      email: email,
      mobile: json['mobile']?.toString() ?? json['phone']?.toString() ?? '',
      firstName: firstName,
      lastName: lastName,
      gender: json['gender']?.toString() ?? '',
      dateOfBirth: json['date_of_birth']?.toString() ?? '',
      isProfileComplete: isComplete,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'user_id': userId,
      'email': email,
      'mobile': mobile,
      'first_name': firstName,
      'last_name': lastName,
      'gender': gender,
      'date_of_birth': dateOfBirth,
      'is_profile_complete': isProfileComplete,
    };
  }
}
