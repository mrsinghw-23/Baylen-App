import 'at_home_beauty.dart';
import 'salon.dart';

enum MyBookingKind { salon, homeService }

enum MyBookingFilter { all, upcoming, completed, cancelled }

extension MyBookingFilterLabel on MyBookingFilter {
  String get label {
    switch (this) {
      case MyBookingFilter.all:
        return 'All';
      case MyBookingFilter.upcoming:
        return 'Upcoming';
      case MyBookingFilter.completed:
        return 'Completed';
      case MyBookingFilter.cancelled:
        return 'Cancelled';
    }
  }
}

class MyBookingEntry {
  const MyBookingEntry({
    required this.kind,
    required this.id,
    required this.title,
    required this.subtitle,
    required this.status,
    required this.displayStatus,
    required this.amountLabel,
    required this.sortAt,
    this.referenceLabel = '',
    this.location = '',
    this.gender = '',
    this.canTrack = false,
    this.salon,
    this.home,
  });

  final MyBookingKind kind;
  final String id;
  final String title;
  final String subtitle;
  final String status;
  final String displayStatus;
  final String amountLabel;
  final DateTime sortAt;
  final String referenceLabel;
  final String location;
  final String gender;
  final bool canTrack;
  final SalonAppointment? salon;
  final AtHomeBooking? home;

  factory MyBookingEntry.fromSalon(SalonAppointment appointment) {
    return MyBookingEntry(
      kind: MyBookingKind.salon,
      id: appointment.id,
      title: appointment.serviceLabel,
      subtitle: [
        if (appointment.salonName.isNotEmpty) appointment.salonName,
        '${appointment.appointmentDate} · ${appointment.startTime}',
      ].where((part) => part.isNotEmpty).join('\n'),
      status: appointment.status,
      displayStatus: appointment.status,
      amountLabel: appointment.totalLabel,
      sortAt: _parseSalonSortAt(appointment),
      referenceLabel: appointment.appointmentNumber,
      location: appointment.location,
      gender: appointment.gender,
      salon: appointment,
    );
  }

  factory MyBookingEntry.fromHome(AtHomeBooking booking) {
    final serviceName = booking.serviceName.isNotEmpty
        ? booking.serviceName
        : 'Home service';
    return MyBookingEntry(
      kind: MyBookingKind.homeService,
      id: booking.id,
      title: serviceName,
      subtitle: [
        if (booking.bookingNumber.isNotEmpty) booking.bookingNumber,
        booking.scheduledAt,
        if (booking.visitCity.isNotEmpty) booking.visitCity,
      ].where((part) => part.isNotEmpty).join('\n'),
      status: booking.status,
      displayStatus: booking.displayStatus,
      amountLabel: booking.amountLabel,
      sortAt: _parseHomeSortAt(booking.scheduledAt),
      referenceLabel: booking.bookingNumber,
      location: [booking.visitLine1, booking.visitCity]
          .where((part) => part.isNotEmpty)
          .join(', '),
      gender: booking.genderPreference,
      canTrack: booking.liveTracking,
      home: booking,
    );
  }

  bool matchesFilter(MyBookingFilter filter) {
    switch (filter) {
      case MyBookingFilter.all:
        return true;
      case MyBookingFilter.upcoming:
        return !_isCancelled && !_isCompleted;
      case MyBookingFilter.completed:
        return _isCompleted;
      case MyBookingFilter.cancelled:
        return _isCancelled;
    }
  }

  bool get needsOnlinePayment {
    if (kind == MyBookingKind.salon) {
      return status.toUpperCase() == 'PENDING_PAYMENT';
    }
    final payment = home?.paymentStatus.toUpperCase() ?? '';
    return status.toUpperCase() == 'REQUESTED' && payment != 'PAID';
  }

  String get paymentReferenceType =>
      kind == MyBookingKind.salon ? 'APPOINTMENT' : 'JOB';

  bool get _isCancelled => status.toUpperCase() == 'CANCELLED';

  bool get _isCompleted {
    final normalized = status.toUpperCase();
    return normalized == 'COMPLETED' || normalized == 'DONE';
  }
}

DateTime _parseSalonSortAt(SalonAppointment appointment) {
  final date = appointment.appointmentDate;
  final time = appointment.startTime;
  if (date.isEmpty) return DateTime.fromMillisecondsSinceEpoch(0);
  final parsed = DateTime.tryParse('$date ${time.isNotEmpty ? time : '00:00'}:00');
  return parsed ?? DateTime.fromMillisecondsSinceEpoch(0);
}

DateTime _parseHomeSortAt(String scheduledAt) {
  if (scheduledAt.isEmpty) return DateTime.fromMillisecondsSinceEpoch(0);
  final normalized = scheduledAt.contains('T')
      ? scheduledAt
      : scheduledAt.replaceFirst(' ', 'T');
  return DateTime.tryParse(normalized) ??
      DateTime.fromMillisecondsSinceEpoch(0);
}

List<MyBookingEntry> mergeMyBookings({
  required List<SalonAppointment> salonAppointments,
  required List<AtHomeBooking> homeBookings,
}) {
  final entries = <MyBookingEntry>[
    ...salonAppointments.map(MyBookingEntry.fromSalon),
    ...homeBookings.map(MyBookingEntry.fromHome),
  ]..sort((a, b) => b.sortAt.compareTo(a.sortAt));
  return entries;
}
