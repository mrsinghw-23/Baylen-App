import '../auth/auth_user.dart';
import '../models/account.dart';
import '../models/order.dart';
import '../models/salon.dart';
import '../models/service_job.dart';

class NotificationPreferences {
  const NotificationPreferences({
    this.pushEnabled = true,
    this.emailEnabled = true,
    this.orderUpdates = true,
    this.bookingUpdates = true,
    this.serviceTracking = true,
    this.offers = true,
  });

  final bool pushEnabled;
  final bool emailEnabled;
  final bool orderUpdates;
  final bool bookingUpdates;
  final bool serviceTracking;
  final bool offers;

  factory NotificationPreferences.fromJson(Map<String, dynamic>? json) {
    bool asBool(dynamic value, bool fallback) {
      if (value == true || value == 'true') return true;
      if (value == false || value == 'false') return false;
      return fallback;
    }

    final data = json ?? const <String, dynamic>{};
    return NotificationPreferences(
      pushEnabled: asBool(data['push_enabled'], true),
      emailEnabled: asBool(data['email_enabled'], true),
      orderUpdates: asBool(data['order_updates'], true),
      bookingUpdates: asBool(data['booking_updates'], true),
      serviceTracking: asBool(data['service_tracking'], true),
      offers: asBool(data['offers'], true),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'push_enabled': pushEnabled,
      'email_enabled': emailEnabled,
      'order_updates': orderUpdates,
      'booking_updates': bookingUpdates,
      'service_tracking': serviceTracking,
      'offers': offers,
    };
  }
}

class AccountBootstrap {
  const AccountBootstrap({
    required this.user,
    this.profile,
    this.addresses = const [],
    this.orders = const [],
    this.appointments = const [],
    this.jobs = const [],
    this.wishlist = const [],
    this.preferences = const NotificationPreferences(),
    this.payments = const [],
    this.fromCache = false,
    this.recoveredAt,
  });

  final AuthUser user;
  final UserProfile? profile;
  final List<Address> addresses;
  final List<ShopOrder> orders;
  final List<SalonAppointment> appointments;
  final List<ServiceJob> jobs;
  final List<WishlistItem> wishlist;
  final NotificationPreferences preferences;
  final List<PaymentRecord> payments;
  final bool fromCache;
  final DateTime? recoveredAt;

  factory AccountBootstrap.fromJson(
    Map<String, dynamic> json, {
    bool fromCache = false,
  }) {
    final userJson = json['user'];
    final profileJson = json['profile'];
    AuthUser user;
    if (userJson is Map<String, dynamic>) {
      user = AuthUser.fromJson(userJson);
    } else if (profileJson is Map<String, dynamic>) {
      user = AuthUser.fromJson({
        'user_id': profileJson['user_id'],
        'email': profileJson['email'],
        'mobile': profileJson['mobile'],
        'first_name': (profileJson['full_name']?.toString() ?? '').split(' ').first,
        'last_name': (profileJson['full_name']?.toString() ?? '')
            .split(' ')
            .skip(1)
            .join(' '),
        'gender': profileJson['gender'],
        'date_of_birth': profileJson['date_of_birth'],
        'profile_photo_url': profileJson['profile_photo_url'],
        'is_profile_complete': true,
      });
    } else {
      user = const AuthUser(
        userId: '',
        email: '',
        mobile: '',
        firstName: '',
        lastName: '',
      );
    }

    List<T> parseList<T>(
      dynamic value,
      T Function(Map<String, dynamic>) map,
    ) {
      if (value is! List) return <T>[];
      return value
          .whereType<Map>()
          .map((item) => map(Map<String, dynamic>.from(item)))
          .toList();
    }

    final bookings = json['bookings'];
    var appointments = parseList(json['appointments'], SalonAppointment.fromJson);
    var jobs = parseList(json['jobs'], ServiceJob.fromJson);
    if (appointments.isEmpty && jobs.isEmpty && bookings is List) {
      for (final item in bookings.whereType<Map>()) {
        final map = Map<String, dynamic>.from(item);
        final type = map['type']?.toString() ?? '';
        if (type == 'home_service' || map.containsKey('visit_city')) {
          jobs.add(ServiceJob.fromJson(map));
        } else {
          appointments.add(SalonAppointment.fromJson(map));
        }
      }
    }

    return AccountBootstrap(
      user: user,
      profile: profileJson is Map<String, dynamic>
          ? UserProfile.fromJson(profileJson)
          : null,
      addresses: parseList(json['addresses'], Address.fromJson),
      orders: parseList(json['orders'], ShopOrder.fromJson),
      appointments: appointments,
      jobs: jobs,
      wishlist: parseList(json['wishlist'], WishlistItem.fromJson),
      preferences: NotificationPreferences.fromJson(
        json['preferences'] is Map<String, dynamic>
            ? json['preferences'] as Map<String, dynamic>
            : null,
      ),
      payments: parseList(json['payments'], PaymentRecord.fromJson),
      fromCache: fromCache,
      recoveredAt: DateTime.tryParse(json['recovered_at']?.toString() ?? ''),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'user': user.toJson(),
      if (profile != null)
        'profile': {
          'user_id': profile!.userId,
          'full_name': profile!.fullName,
          'mobile': profile!.mobile,
          'email': profile!.email,
          'gender': profile!.gender,
          'date_of_birth': profile!.dateOfBirth,
          'profile_photo_url': profile!.profilePhotoUrl,
          'loyalty_tier': profile!.loyaltyTier,
          'loyalty_points': profile!.loyaltyPoints,
          'created_at': profile!.createdAt,
        },
      'addresses': addresses
          .map(
            (address) => {
              'id': address.id,
              'label': address.label,
              'full_name': address.fullName,
              'phone': address.phone,
              'line1': address.line1,
              'line2': address.line2,
              'landmark': address.landmark,
              'city': address.city,
              'state': address.state,
              'postal_code': address.postalCode,
              'country': address.country,
              'is_default': address.isDefault,
              'latitude': address.latitude,
              'longitude': address.longitude,
            },
          )
          .toList(),
      'orders': orders
          .map(
            (order) => {
              'id': order.id,
              'order_number': order.orderNumber,
              'status': order.status,
              'payment_status': order.paymentStatus,
              'currency': order.currency,
              'subtotal': order.subtotal,
              'grand_total': order.grandTotal,
              'shipping_name': order.shippingName,
              'shipping_line1': order.shippingLine1,
              'shipping_city': order.shippingCity,
            },
          )
          .toList(),
      'appointments': appointments
          .map(
            (item) => {
              'id': item.id,
              'appointment_number': item.appointmentNumber,
              'appointment_date': item.appointmentDate,
              'start_time': item.startTime,
              'end_time': item.endTime,
              'status': item.status,
              'payment_status': item.paymentStatus,
              'currency': item.currency,
              'grand_total': item.grandTotal,
              'items': const [],
            },
          )
          .toList(),
      'jobs': jobs
          .map(
            (job) => {
              'id': job.id,
              'appointment_id': job.appointmentId,
              'provider_id': job.providerId,
              'status': job.status,
              'visit_line1': job.visitLine1,
              'visit_city': job.visitCity,
              'scheduled_at': job.scheduledAt,
              'grand_total': job.grandTotal,
              'currency': job.currency,
            },
          )
          .toList(),
      'wishlist': wishlist
          .map(
            (item) => {
              'id': item.id,
              'product_id': item.productId,
              'variant_id': item.variantId,
              'name': item.name,
              'thumbnail_url': item.thumbnailUrl,
              'mrp': item.mrp,
              'selling_price': item.sellingPrice,
              'currency': item.currency,
            },
          )
          .toList(),
      'preferences': preferences.toJson(),
      'payments': payments
          .map(
            (item) => {
              'id': item.id,
              'reference_type': item.referenceType,
              'reference_id': item.referenceId,
              'provider': item.provider,
              'amount': item.amount,
              'currency': item.currency,
              'status': item.status,
            },
          )
          .toList(),
      'recovered_at': (recoveredAt ?? DateTime.now()).toIso8601String(),
    };
  }

  AccountBootstrap copyWith({bool? fromCache}) {
    return AccountBootstrap(
      user: user,
      profile: profile,
      addresses: addresses,
      orders: orders,
      appointments: appointments,
      jobs: jobs,
      wishlist: wishlist,
      preferences: preferences,
      payments: payments,
      fromCache: fromCache ?? this.fromCache,
      recoveredAt: recoveredAt,
    );
  }
}
