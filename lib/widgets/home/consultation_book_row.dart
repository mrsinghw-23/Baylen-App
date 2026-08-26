import 'package:flutter/material.dart';

import '_home_constants.dart';

class ConsultationBookRow extends StatelessWidget {
  const ConsultationBookRow({
    super.key,
    required this.onConsultation,
    required this.onBookAppointment,
  });
  final VoidCallback onConsultation;
  final VoidCallback onBookAppointment;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: onConsultation,
              child: Container(
                height: 150,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: kHomeCard,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: kHomePink.withValues(alpha: 0.35)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Quick Consultation',
                          style: TextStyle(
                            color: kHomePink,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Get expert advice for your beauty needs.',
                          style: TextStyle(
                            color: kHomeTextSecondary,
                            fontSize: 11,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: kHomePink,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        "Let's Talk",
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: GestureDetector(
              onTap: onBookAppointment,
              child: Container(
                height: 150,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: kHomeCard,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: kHomePink.withValues(alpha: 0.35)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Book Now',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Choose service, date & time that suits you.',
                                style: TextStyle(
                                  color: kHomeTextSecondary,
                                  fontSize: 11,
                                  height: 1.4,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: kHomePink.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: kHomePink.withValues(alpha: 0.35),
                            ),
                          ),
                          child: const Icon(
                            Icons.calendar_today_outlined,
                            color: kHomePink,
                            size: 16,
                          ),
                        ),
                      ],
                    ),
                    SizedBox(
                      width: double.infinity,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 9,
                        ),
                        decoration: BoxDecoration(
                          color: kHomePink,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Center(
                          child: Text(
                            'Book Appointment',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
