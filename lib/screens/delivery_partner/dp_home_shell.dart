import 'package:flutter/material.dart';



import '../../auth/delivery_partner_auth_service.dart';

import '../../models/delivery_partner_kyc.dart';

import 'delivery_partner_kyc_screen.dart';

import 'dp_dashboard_screen.dart';

import 'leads_screen.dart';

import 'my_jobs_screen.dart';



class DpHomeShell extends StatefulWidget {

  const DpHomeShell({super.key});



  @override

  State<DpHomeShell> createState() => _DpHomeShellState();

}



class _DpHomeShellState extends State<DpHomeShell> {

  int _index = 0;

  DeliveryPartnerKyc? _kyc;

  bool _checkingKyc = true;



  @override

  void initState() {

    super.initState();

    _loadKyc();

  }



  Future<void> _loadKyc() async {

    try {

      final kyc =

          await DeliveryPartnerAuthService.instance.api.fetchDeliveryPartnerKyc();

      if (!mounted) return;

      setState(() {

        _kyc = kyc;

        _checkingKyc = false;

      });

    } catch (_) {

      if (!mounted) return;

      setState(() => _checkingKyc = false);

    }

  }



  Future<void> _openKyc() async {

    await Navigator.of(context).push<void>(

      MaterialPageRoute<void>(builder: (_) => const DeliveryPartnerKycScreen()),

    );

    await _loadKyc();

  }



  @override

  Widget build(BuildContext context) {

    final session = DeliveryPartnerAuthService.instance.session.value;

    final operational = _kyc?.operational == true;



    return Scaffold(

      appBar: AppBar(

        title: const Text('Professional'),

        actions: [

          if (session != null && !operational)

            Padding(

              padding: const EdgeInsets.only(right: 8),

              child: Chip(

                label: Text(_kyc?.partnerStatusLabel ?? 'KYC required'),

              ),

            ),

          IconButton(

            tooltip: 'KYC',

            onPressed: _openKyc,

            icon: const Icon(Icons.verified_user_outlined),

          ),

          IconButton(

            tooltip: 'Sign out',

            onPressed: () async {

              await DeliveryPartnerAuthService.instance.signOut();

              if (!context.mounted) return;

              Navigator.of(context).popUntil((route) => route.isFirst);

            },

            icon: const Icon(Icons.logout),

          ),

        ],

      ),

      body: Column(

        children: [

          if (!_checkingKyc && !operational)

            MaterialBanner(

              content: const Text(

                'Complete KYC to activate your Professional account.',

              ),

              actions: [

                TextButton(onPressed: _openKyc, child: const Text('Complete KYC')),

              ],

            ),

          Expanded(

            child: IndexedStack(

              index: _index,

              children: [

                const DpDashboardScreen(),

                operational ? const LeadsScreen() : const SizedBox.shrink(),

                operational ? const MyJobsScreen() : const SizedBox.shrink(),

              ],

            ),

          ),

        ],

      ),

      bottomNavigationBar: NavigationBar(

        selectedIndex: _index,

        onDestinationSelected: (value) {

          if (!operational && value > 0) {

            _openKyc();

            return;

          }

          setState(() => _index = value);

        },

        destinations: [

          const NavigationDestination(

            icon: Icon(Icons.dashboard_outlined),

            selectedIcon: Icon(Icons.dashboard),

            label: 'Dashboard',

          ),

          NavigationDestination(

            icon: Icon(Icons.inbox_outlined, color: operational ? null : Colors.grey),

            selectedIcon: Icon(Icons.inbox, color: operational ? null : Colors.grey),

            label: 'Leads',

          ),

          NavigationDestination(

            icon: Icon(Icons.work_outline, color: operational ? null : Colors.grey),

            selectedIcon: Icon(Icons.work, color: operational ? null : Colors.grey),

            label: 'My Jobs',

          ),

        ],

      ),

    );

  }

}


