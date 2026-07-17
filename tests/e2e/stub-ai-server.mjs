import { createServer } from 'node:http';

const DRAFT = JSON.stringify({
  program: {
    name: 'Bachelor of Science in Computer Science',
    institution: 'State University',
    catalog_year: '2024',
    total_credits_required: 120,
    gpa_requirement: 2,
  },
  courses: [
    { code: 'CS 101', title: 'Introduction to Computer Science', credits: 4 },
    { code: 'CS 201', title: 'Data Structures', credits: 4 },
    { code: 'MATH 151', title: 'Calculus I', credits: 4 },
  ],
  requirements: [
    {
      type: 'course',
      course_code: 'CS 101',
      group_name: 'Core',
      description: 'Intro to CS',
    },
    {
      type: 'course',
      course_code: 'CS 201',
      group_name: 'Core',
      description: 'Data Structures',
    },
    {
      type: 'course',
      course_code: 'MATH 151',
      group_name: 'Core',
      description: 'Calculus I',
    },
    {
      type: 'credit_bucket',
      credits_required: 6,
      group_name: 'Humanities Electives',
      bucket_rule: { subjects: ['HUM'] },
      description: '6 credits of Humanities electives',
    },
    {
      type: 'gpa',
      group_name: 'Academic standing',
      description: 'Minimum cumulative GPA 2.0',
    },
  ],
  completed_courses: [],
  confidence_flags: [],
});

const GREEN = 'All systems are green. Database, AI, and scheduler look good. ☁️';

function replyPayload(request) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const lastText = typeof lastUser?.content === 'string'
    ? lastUser.content
    : JSON.stringify(lastUser?.content ?? '');
  if (lastText.includes('DEGREE AUDIT FIXTURE')) {
    return { role: 'assistant', content: DRAFT };
  }
  if (messages.some((message) => message.role === 'tool')) {
    return { role: 'assistant', content: GREEN };
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_stub_1',
        type: 'function',
        function: { name: 'get_system_status', arguments: '{}' },
      }],
    };
  }
  return { role: 'assistant', content: 'Hello from the stub AI.' };
}

createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end('not found');
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const payload = replyPayload(body);
    const model = body.model ?? 'gpt-5.6-luna';
    if (body.stream) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const delta = payload.tool_calls
        ? {
            role: 'assistant',
            tool_calls: payload.tool_calls.map((call, index) => ({
              ...call,
              index,
            })),
          }
        : { role: 'assistant', content: payload.content };
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          delta,
          finish_reason: payload.tool_calls ? 'tool_calls' : 'stop',
        }],
      })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-stub',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: payload,
        finish_reason: payload.tool_calls ? 'tool_calls' : 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
}).listen(3999, '127.0.0.1', () => {
  console.log('stub-ai listening on 127.0.0.1:3999');
});
