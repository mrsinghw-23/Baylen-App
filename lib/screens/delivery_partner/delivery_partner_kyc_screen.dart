import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/catalyst_api.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/role_switch_dialog.dart';
import '../../auth/professional_onboarding.dart';
import '../../models/delivery_partner_kyc.dart';
import '../../models/delivery_partner_session.dart';
import '../../utils/kyc_document_picker.dart';
import '../../utils/registration_photo_picker.dart';
import '../../widgets/home/_home_constants.dart';

// KYC v1 (manual, locked): Aadhaar → front → back → passport selfie.
// Future DigiLocker integration: see .cursor/rules/kyc-flow-locked.mdc

class DeliveryPartnerKycScreen extends StatefulWidget {
  const DeliveryPartnerKycScreen({
    super.key,
    this.onFinished,
    this.onSignedOut,
  });

  final VoidCallback? onFinished;
  final VoidCallback? onSignedOut;

  @override
  State<DeliveryPartnerKycScreen> createState() =>
      _DeliveryPartnerKycScreenState();
}

class _DeliveryPartnerKycScreenState extends State<DeliveryPartnerKycScreen> {
  DeliveryPartnerKyc? _kyc;
  bool _loading = true;
  bool _submitting = false;
  bool _uploadingDoc = false;
  bool _kycRecordExists = false;
  bool _savingAadhaar = false;
  String? _error;
  final Set<String> _uploadedThisSession = {};

  final _aadhaar = TextEditingController();

  @override
  void initState() {
    super.initState();
    _aadhaar.addListener(_onFormChanged);
    _load();
  }

  @override
  void dispose() {
    _aadhaar.removeListener(_onFormChanged);
    _aadhaar.dispose();
    super.dispose();
  }

  void _onFormChanged() {
    if (!mounted || _submitting || _uploadingDoc) return;
    if (_error != null && (_isReady || _hasAadhaar())) {
      setState(() => _error = null);
    }
    final digits = _aadhaar.text.trim();
    if (digits.length == 12 && !_savingAadhaar) {
      _saveAadhaarNumber(showErrors: false);
    }
  }

  bool _hasAadhaar() {
    if (_aadhaar.text.trim().length == 12) return true;
    return _kyc?.aadhaarMasked.isNotEmpty == true;
  }

  bool _docUploaded(String documentType) {
    if (_uploadedThisSession.contains(documentType)) return true;
    final kyc = _kyc;
    if (kyc == null) return false;
    switch (documentType) {
      case 'identity_document':
        return kyc.documents.aadhaarFront.uploaded;
      case 'address_document':
        return kyc.documents.aadhaarBack.uploaded;
      case 'profile_photo':
        return kyc.documents.profilePhoto.uploaded;
      default:
        return false;
    }
  }

  bool get _canUploadAadhaarFront => _hasAadhaar();

  bool get _canUploadAadhaarBack => _docUploaded('identity_document');

  bool get _canTakeSelfie => _docUploaded('address_document');

  bool get _isReady {
    return _hasAadhaar() &&
        _docUploaded('identity_document') &&
        _docUploaded('address_document') &&
        _docUploaded('profile_photo');
  }

  int get _completedSteps {
    var count = 0;
    if (_hasAadhaar()) count++;
    if (_docUploaded('identity_document')) count++;
    if (_docUploaded('address_document')) count++;
    if (_docUploaded('profile_photo')) count++;
    return count;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final kyc = await DeliveryPartnerAuthService.instance.api.fetchDeliveryPartnerKyc();
      if (!mounted) return;
      _applyKyc(kyc);
      setState(() => _loading = false);
      if (_isReady) {
        await _completeKyc();
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isForbiddenRole) {
        await showRoleSwitchDialog(context, error: error);
      }
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  void _applyKyc(DeliveryPartnerKyc kyc) {
    _kyc = kyc;
    _kycRecordExists = kyc.kycId.isNotEmpty;
  }

  Future<void> _saveAadhaarNumber({bool showErrors = true}) async {
    final digits = _aadhaar.text.trim();
    if (digits.length != 12) return;
    if (_savingAadhaar) return;
    _savingAadhaar = true;
    final payload = {'aadhaar_number': digits};
    final api = DeliveryPartnerAuthService.instance.api;
    try {
      DeliveryPartnerKyc saved;
      if (_kycRecordExists || (_kyc?.kycId.isNotEmpty ?? false)) {
        saved = await api.updateDeliveryPartnerKyc(payload);
      } else {
        try {
          saved = await api.createDeliveryPartnerKyc(payload);
        } on ApiException catch (error) {
          if (error.statusCode == 409 || error.code == 'KYC_EXISTS') {
            saved = await api.updateDeliveryPartnerKyc(payload);
          } else {
            rethrow;
          }
        }
      }
      if (!mounted) return;
      _applyKyc(saved);
      setState(() => _error = null);
    } on ApiException catch (error) {
      if (!mounted) return;
      if (showErrors) {
        setState(() => _error = error.message);
      }
      rethrow;
    } finally {
      _savingAadhaar = false;
    }
  }

  Future<void> _pickAndUploadDocument({
    required String documentType,
    required String title,
    bool useFrontCamera = false,
    KycDocumentSource? forcedSource,
  }) async {
    if (documentType == 'identity_document' && !_canUploadAadhaarFront) {
      setState(() => _error = 'Enter and save your 12-digit Aadhaar first.');
      return;
    }
    if (documentType == 'address_document' && !_canUploadAadhaarBack) {
      setState(() => _error = 'Upload Aadhaar front photo first.');
      return;
    }
    if (_uploadingDoc) return;
    setState(() {
      _error = null;
      _uploadingDoc = true;
    });
    try {
      final picked = await pickKycDocument(
        context: context,
        title: title,
        useFrontCamera: useFrontCamera,
        forcedSource: forcedSource,
      );
      if (!mounted) return;
      if (picked == null) {
        setState(() => _uploadingDoc = false);
        return;
      }
      if (_hasAadhaar()) {
        try {
          await _saveAadhaarNumber(showErrors: false);
        } catch (_) {}
      }
      final updated = await DeliveryPartnerAuthService.instance.api
          .uploadDeliveryPartnerKycDocument(
            documentType: documentType,
            fileName: picked.fileName,
            contentType: picked.contentType,
            base64: base64Encode(picked.bytes),
          );
      if (!mounted) return;
      _applyKyc(updated);
      setState(() {
        _uploadingDoc = false;
        _uploadedThisSession.add(documentType);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$title added')),
      );
      if (_isReady) {
        await _completeKyc();
      }
    } on RegistrationPhotoException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.message;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _pickSelfie() async {
    if (!_canTakeSelfie) {
      setState(() => _error = 'Upload Aadhaar back photo first.');
      return;
    }
    if (_uploadingDoc) return;
    setState(() {
      _error = null;
      _uploadingDoc = true;
    });
    try {
      final picked = await pickKycSelfie(context: context);
      if (!mounted) return;
      if (picked == null) {
        setState(() => _uploadingDoc = false);
        return;
      }
      if (_hasAadhaar()) {
        try {
          await _saveAadhaarNumber(showErrors: false);
        } catch (_) {}
      }
      final updated = await DeliveryPartnerAuthService.instance.api
          .uploadDeliveryPartnerKycDocument(
            documentType: 'profile_photo',
            fileName: picked.fileName,
            contentType: picked.contentType,
            base64: base64Encode(picked.bytes),
          );
      if (!mounted) return;
      _applyKyc(updated);
      setState(() {
        _uploadingDoc = false;
        _uploadedThisSession.add('profile_photo');
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Passport-size selfie saved to your profile')),
      );
      if (_isReady) {
        await _completeKyc();
      }
    } on RegistrationPhotoException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.message;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _deleteDocument({
    required String documentType,
    required String title,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Delete $title?'),
          content: Text('You can add it again anytime.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _error = null;
      _uploadingDoc = true;
    });
    try {
      final updated = await DeliveryPartnerAuthService.instance.api
          .deleteDeliveryPartnerKycDocument(documentType: documentType);
      if (!mounted) return;
      _applyKyc(updated);
      setState(() {
        _uploadingDoc = false;
        _uploadedThisSession.remove(documentType);
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _uploadingDoc = false;
        _error = error.message;
      });
    }
  }

  String? _readinessMessage() {
    if (!_hasAadhaar()) {
      return 'Enter your 12-digit Aadhaar number.';
    }
    if (!_docUploaded('identity_document')) {
      return 'Add Aadhaar front photo.';
    }
    if (!_docUploaded('address_document')) {
      return 'Add Aadhaar back photo.';
    }
    if (!_docUploaded('profile_photo')) {
      return 'Take a selfie.';
    }
    return null;
  }

  Future<void> _completeKyc() async {
    if (_submitting || !_isReady) return;
    final readiness = _readinessMessage();
    if (readiness != null) {
      setState(() => _error = readiness);
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final aadhaarDigits = _aadhaar.text.trim();
      if (aadhaarDigits.length == 12) {
        await _saveAadhaarNumber();
      }
      final result = await DeliveryPartnerAuthService.instance.api
          .submitDeliveryPartnerKyc(
        aadhaarNumber: aadhaarDigits.length == 12 ? aadhaarDigits : null,
      );
      final current = DeliveryPartnerAuthService.instance.session.value;
      if (current != null) {
        await DeliveryPartnerAuthService.instance.applySessionToken(
          result.token,
          sessionOverride: DeliveryPartnerSession(
            deliveryPartnerId: current.deliveryPartnerId,
            phone: current.phone,
            status: result.kyc.partnerStatus,
            outletId: current.outletId,
            firstName: result.kyc.firstName,
            lastName: result.kyc.lastName,
          ),
        );
      } else {
        await DeliveryPartnerAuthService.instance.applySessionToken(result.token);
      }
      if (!mounted) return;
      _applyKyc(result.kyc);
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('KYC complete. Opening dashboard…')),
      );
      if (widget.onFinished != null) {
        widget.onFinished!();
        return;
      }
      await ProfessionalOnboarding.navigateAfterKycSubmit(context);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final kyc = _kyc;
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        foregroundColor: Colors.white,
        title: const Text('Professional KYC'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: kHomePink))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _SectionCard(
                  title: 'Quick KYC',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        kyc?.operational == true
                            ? 'Your KYC is complete. Go online from the dashboard to accept jobs.'
                            : 'Complete each step in order: Aadhaar number → front → back → passport-size selfie.',
                        style: const TextStyle(color: kHomeTextSecondary),
                      ),
                      const SizedBox(height: 12),
                      _KycStepProgress(completed: _completedSteps, total: 4),
                      const SizedBox(height: 16),
                      TextField(
                        controller: _aadhaar,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(12),
                        ],
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          labelText: 'Aadhaar number (12 digits)',
                          labelStyle: const TextStyle(color: kHomeTextSecondary),
                          filled: true,
                          fillColor: kHomeCard,
                          suffixIcon: _hasAadhaar()
                              ? const Icon(Icons.check_circle, color: Colors.greenAccent)
                              : null,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                      if (_savingAadhaar)
                        const Padding(
                          padding: EdgeInsets.only(top: 8),
                          child: Text(
                            'Saving Aadhaar…',
                            style: TextStyle(color: kHomeTextSecondary, fontSize: 12),
                          ),
                        )
                      else if (kyc?.aadhaarMasked.isNotEmpty == true)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            'Saved: ${kyc!.aadhaarMasked}',
                            style: const TextStyle(color: Colors.greenAccent, fontSize: 12),
                          ),
                        ),
                      const SizedBox(height: 12),
                      _DocumentTile(
                        label: 'Aadhaar front',
                        uploaded: _docUploaded('identity_document'),
                        busy: _uploadingDoc,
                        enabled: _canUploadAadhaarFront,
                        lockedHint: 'Enter and save your 12-digit Aadhaar first.',
                        onAdd: () => _pickAndUploadDocument(
                          documentType: 'identity_document',
                          title: 'Aadhaar front',
                        ),
                        onDelete: () => _deleteDocument(
                          documentType: 'identity_document',
                          title: 'Aadhaar front',
                        ),
                      ),
                      _DocumentTile(
                        label: 'Aadhaar back',
                        uploaded: _docUploaded('address_document'),
                        busy: _uploadingDoc,
                        enabled: _canUploadAadhaarBack,
                        lockedHint: 'Upload Aadhaar front photo first.',
                        onAdd: () => _pickAndUploadDocument(
                          documentType: 'address_document',
                          title: 'Aadhaar back',
                        ),
                        onDelete: () => _deleteDocument(
                          documentType: 'address_document',
                          title: 'Aadhaar back',
                        ),
                      ),
                      _DocumentTile(
                        label: 'Selfie (passport size)',
                        uploaded: _docUploaded('profile_photo'),
                        busy: _uploadingDoc,
                        enabled: _canTakeSelfie,
                        lockedHint: 'Upload Aadhaar back photo first.',
                        addLabel: 'Take selfie',
                        replaceLabel: 'Retake',
                        onAdd: _pickSelfie,
                        onDelete: () => _deleteDocument(
                          documentType: 'profile_photo',
                          title: 'Selfie',
                        ),
                      ),
                    ],
                  ),
                ),
                if (kyc?.editable == true)
                  HomeFullWidthButton(
                    label: _submitting
                        ? 'Opening dashboard…'
                        : 'Complete KYC & go to dashboard',
                    loading: _submitting,
                    onPressed: _submitting || _uploadingDoc ? null : _completeKyc,
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                ],
              ],
            ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: kHomeCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: kHomeOutline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: kHomePink,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _KycStepProgress extends StatelessWidget {
  const _KycStepProgress({required this.completed, required this.total});

  final int completed;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            value: total == 0 ? 0 : completed / total,
            minHeight: 6,
            backgroundColor: kHomeOutline,
            color: kHomePink,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '$completed of $total steps done',
          style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
        ),
      ],
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.label,
    required this.uploaded,
    this.onAdd,
    this.onDelete,
    this.busy = false,
    this.enabled = true,
    this.lockedHint,
    this.addLabel = 'Add',
    this.replaceLabel = 'Replace',
  });

  final String label;
  final bool uploaded;
  final VoidCallback? onAdd;
  final VoidCallback? onDelete;
  final bool busy;
  final bool enabled;
  final String? lockedHint;
  final String addLabel;
  final String replaceLabel;

  @override
  Widget build(BuildContext context) {
    final canAct = enabled && !busy;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            label,
            style: TextStyle(
              color: enabled ? Colors.white : Colors.white38,
            ),
          ),
          trailing: busy
              ? const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (uploaded)
                      const Padding(
                        padding: EdgeInsets.only(right: 4),
                        child: Icon(Icons.check_circle, color: Colors.greenAccent),
                      ),
                    if (onAdd != null)
                      TextButton(
                        onPressed: canAct ? onAdd : null,
                        child: Text(uploaded ? replaceLabel : addLabel),
                      ),
                    if (uploaded && onDelete != null)
                      TextButton(
                        onPressed: canAct ? onDelete : null,
                        child: const Text('Delete'),
                      ),
                  ],
                ),
        ),
        if (!enabled && lockedHint != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              lockedHint!,
              style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
            ),
          ),
      ],
    );
  }
}
