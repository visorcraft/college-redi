# About Redi

## What Inspired Me

Redi was inspired by my family. One of my sons is currently in college, and another recently graduated. Watching both of them navigate college showed me that academic success is only part of the challenge. Students also have to manage registration dates, degree requirements, important emails, forms, and deadlines, often across several disconnected systems.

I built Redi to make that work easier to understand and harder to miss. The goal is simple: give a student one dependable place to see what needs attention, what comes next, and how close they are to graduation.

## What I Learned

Building Redi taught me that the most useful technology does not add more noise. It organizes information, highlights what matters, and helps people act with confidence. I also learned that automation works best when it supports a person instead of trying to replace their judgment.

This project deepened my understanding of secure data handling, practical AI, email processing, degree planning, and accessible product design. More importantly, it reinforced the value of building around real experiences. Features became clearer when I considered the questions students and families actually ask: “Am I on track?”, “What deadline did I miss?”, and “What do I need to do next?”

## How I Built It

I built Redi as a self-hosted web application using Next.js, React, and TypeScript, with MongrelDB providing encrypted storage. It combines degree planning, registration tracking, administrative reminders, and college-email monitoring in one place.

Redi can model degree requirements, track completed and planned courses, estimate graduation progress, and monitor registration status. It can also connect to a college inbox through read-only IMAP, use AI to identify important messages and deadlines, and turn those details into clear summaries and actionable tasks. Security and privacy were part of the design from the beginning, including encrypted secrets, protected sessions, limited email access, and careful handling of student data.

## Challenges We Faced

The biggest challenge was turning information from different sources into something consistent and useful. Degree audits, course plans, emails, and administrative requirements rarely follow one standard format. Important details can be buried in long messages, change over time, or depend on context.

Another challenge was balancing helpful automation with accuracy and trust. A system like Redi must avoid inventing dates, requirements, or advice. That meant designing it to rely on stored student information and verified tools, while keeping the student in control.

The experience of supporting one son through college and watching another complete the journey kept the project grounded. Redi grew from challenges our family could relate to, and it was built to help other students and families feel more organized, informed, and prepared.
