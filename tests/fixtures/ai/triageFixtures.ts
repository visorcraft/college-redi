export const actionableResultJson = JSON.stringify({
  results: [{
    index: 0,
    classification: 'actionable',
    summary: 'The registrar says your Fall 2026 registration window closes Friday, July 24 at 5:00 PM ET, and tuition is due August 1.',
    importance: 'urgent',
    events: [
      {
        title: 'Fall 2026 registration closes',
        event_type: 'registration',
        due_at: '2026-07-24T17:00:00-04:00',
        confidence: 0.97,
      },
      {
        title: 'Tuition payment due',
        event_type: 'payment',
        due_at: '2026-08-01T23:59:00-04:00',
        confidence: 0.72,
      },
    ],
    rationale: 'Personally addressed, hard deadline from registrar.',
  }],
});

export const junkResultJson = JSON.stringify({
  results: [{
    index: 0,
    classification: 'junk',
    summary: 'Campus store 40%-off promo.',
    importance: 'low',
    events: [],
    rationale: 'Marketing blast, no personal action.',
  }],
});

export const ambiguousDateResultJson = JSON.stringify({
  results: [{
    index: 0,
    classification: 'actionable',
    summary: 'Your advisor asks you to book a meeting "early next week" but gives no firm date.',
    importance: 'normal',
    events: [{
      title: 'Book advisor meeting',
      event_type: 'appointment',
      due_at: null,
      confidence: 0.6,
    }],
    rationale: 'Action requested, date ambiguous.',
  }],
});

export const malformedThenFixed = [
  'not json at all',
  JSON.stringify({
    results: [{
      index: 0,
      classification: 'informational',
      summary: 'Library summer hours are 8am-6pm weekdays.',
      importance: 'low',
      events: [],
      rationale: 'FYI only.',
    }],
  }),
];
