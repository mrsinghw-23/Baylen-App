String beautyStatusLabel(String status) {
  switch (status.trim().toUpperCase()) {
    case 'REQUESTED':
      return 'Booking received';
    case 'CONFIRMED':
      return 'Booking confirmed';
    case 'ASSIGNED':
      return 'Professional assigned';
    case 'ACCEPTED':
      return 'Professional confirmed';
    case 'EN_ROUTE':
      return 'Professional on the way';
    case 'ARRIVED':
      return 'Professional has arrived';
    case 'STARTED':
      return 'Service in progress';
    case 'COMPLETED':
      return 'Service completed';
    case 'CANCELLED':
      return 'Booking cancelled';
    case 'RESCHEDULED':
      return 'Booking rescheduled';
    default:
      return 'Processing your booking';
  }
}

bool beautyLiveTrackingEnabled(String status) {
  switch (status.trim().toUpperCase()) {
    case 'EN_ROUTE':
    case 'ARRIVED':
    case 'STARTED':
      return true;
    default:
      return false;
  }
}
