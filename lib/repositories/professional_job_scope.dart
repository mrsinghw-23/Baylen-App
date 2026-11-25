import 'package:flutter/material.dart';

import '../repositories/hybrid_professional_job_repository.dart';
import '../repositories/professional_job_repository.dart';
import '../state/professional_dashboard_store.dart';

/// Provides the Professional repository and live dashboard store.
class ProfessionalJobScope extends InheritedNotifier<ProfessionalDashboardStore> {
  ProfessionalJobScope({
    super.key,
    required this.repository,
    ProfessionalDashboardStore? store,
    required super.child,
  }) : super(notifier: store ?? ProfessionalDashboardStore(repository));

  final ProfessionalJobRepository repository;

  static ProfessionalJobRepository of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<ProfessionalJobScope>();
    assert(scope != null, 'ProfessionalJobScope not found');
    return scope!.repository;
  }

  static ProfessionalDashboardStore storeOf(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<ProfessionalJobScope>();
    assert(scope != null, 'ProfessionalJobScope not found');
    return scope!.notifier!;
  }

  static ProfessionalDashboardStore? maybeStoreOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<ProfessionalJobScope>()
        ?.notifier;
  }

  static ProfessionalJobRepository maybeOf(BuildContext context) {
    return context
            .dependOnInheritedWidgetOfExactType<ProfessionalJobScope>()
            ?.repository ??
        HybridProfessionalJobRepository();
  }

  /// Run after first frame so [of] is safe (not from [State.initState]).
  static void scheduleLoad(VoidCallback load) {
    WidgetsBinding.instance.addPostFrameCallback((_) => load());
  }

  /// Preserve repository and store when pushing Professional flow routes.
  static Widget wrapRoute(BuildContext context, Widget child) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<ProfessionalJobScope>();
    if (scope == null) {
      final repository = HybridProfessionalJobRepository();
      return ProfessionalJobScope(
        repository: repository,
        store: ProfessionalDashboardStore(repository),
        child: child,
      );
    }
    return ProfessionalJobScope(
      repository: scope.repository,
      store: scope.notifier,
      child: child,
    );
  }

  @override
  bool updateShouldNotify(ProfessionalJobScope oldWidget) =>
      oldWidget.repository != repository || oldWidget.notifier != notifier;
}
