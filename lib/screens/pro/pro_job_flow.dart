import 'package:flutter/material.dart';

import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import 'pro_flow_screens.dart';

/// Navigation helpers for product delivery and home service flows.
class ProJobFlow {
  ProJobFlow._();

  static Route<void> _route(BuildContext context, Widget screen) {
    return MaterialPageRoute<void>(
      builder: (_) => ProfessionalJobScope.wrapRoute(context, screen),
    );
  }

  static Future<void> openOfferDetail(
    BuildContext context,
    ProfessionalJobOffer offer,
  ) {
    return openJobDetail(context, offer.id, offer.type);
  }

  static Future<void> openJobDetail(
    BuildContext context,
    String jobId,
    ProfessionalJobType type,
  ) {
    if (type == ProfessionalJobType.productDelivery) {
      return Navigator.of(context).push(
        _route(context, ProProductDetailScreen(jobId: jobId)),
      );
    }
    return Navigator.of(context).push(
      _route(context, ProHomeServiceDetailScreen(jobId: jobId)),
    );
  }

  static Future<void> openProductPickupFlow(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProProductNavigationScreen(jobId: jobId)),
    );
  }

  static Future<void> openProductPickupOtp(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProProductOtpScreen(jobId: jobId, pickup: true)),
    );
  }

  static Future<void> openProductDeliveryOtp(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProProductOtpScreen(jobId: jobId, pickup: false)),
    );
  }

  static Future<void> openProductCompletion(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProDeliveryCompletionScreen(jobId: jobId)),
    );
  }

  static Future<void> openHomeServicePrep(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProServicePrepScreen(jobId: jobId)),
    );
  }

  static Future<void> openHomeServiceNavigation(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProServiceNavigationScreen(jobId: jobId)),
    );
  }

  static Future<void> openArrivalOtp(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProArrivalOtpScreen(jobId: jobId)),
    );
  }

  static Future<void> openServiceVerified(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProServiceVerifiedScreen(jobId: jobId)),
    );
  }

  static Future<void> openServiceInProgress(BuildContext context, String jobId) {
    return Navigator.of(context).push(
      _route(context, ProServiceInProgressScreen(jobId: jobId)),
    );
  }

  static Future<void> openCompletionEarnings(
    BuildContext context,
    String jobId, {
    required CompletionResult result,
  }) {
    return Navigator.of(context).push(
      _route(context, ProCompletionEarningsScreen(jobId: jobId, result: result)),
    );
  }
}
