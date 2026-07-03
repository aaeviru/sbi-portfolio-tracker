var https = require('https');

var DEFAULT_MODEL = process.env.OPENAI_REPORT_MODEL || 'gpt-4.1-mini';
var DEFAULT_WEB_SEARCH_TOOL = process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search';

function extractText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  var parts = [];
  (response.output || []).forEach(function (item) {
    (item.content || []).forEach(function (content) {
      if (content.type == 'output_text' && content.text) {
        parts.push(content.text);
      }
    });
  });
  return parts.join('\n\n');
}

function extractSources(response) {
  var sources = [];

  function addUrl(url, title) {
    if (!url || sources.some(function (source) { return source.url == url; })) {
      return;
    }
    sources.push({ url: url, title: title || url });
  }

  (response.output || []).forEach(function (item) {
    if (item.type == 'web_search_call' && item.action && item.action.sources) {
      item.action.sources.forEach(function (source) {
        addUrl(source.url, source.title);
      });
    }
    (item.content || []).forEach(function (content) {
      (content.annotations || []).forEach(function (annotation) {
        addUrl(annotation.url, annotation.title);
      });
    });
  });

  return sources;
}

function postJson(path, body, callback) {
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    callback(new Error('OPENAI_API_KEY is not set.'));
    return;
  }

  var payload = JSON.stringify(body);
  var req = https.request({
    hostname: 'api.openai.com',
    path: path,
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: Number(process.env.OPENAI_REPORT_TIMEOUT_MS || 120000)
  }, function (res) {
    var chunks = [];
    res.on('data', function (chunk) {
      chunks.push(chunk);
    });
    res.on('end', function () {
      var text = Buffer.concat(chunks).toString('utf8');
      var parsed = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch (err) {
        callback(new Error('OpenAI returned non-JSON response: ' + text.slice(0, 300)));
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        var message = parsed && parsed.error && parsed.error.message ? parsed.error.message : text;
        callback(new Error('OpenAI API error ' + res.statusCode + ': ' + message));
        return;
      }

      callback(null, parsed);
    });
  });

  req.on('timeout', function () {
    req.destroy(new Error('OpenAI report request timed out.'));
  });
  req.on('error', callback);
  req.write(payload);
  req.end();
}

function buildDailyReportMessages(snapshot) {
  return [
    {
      role: 'system',
      content: [
        'You write concise daily portfolio reports for personal analysis.',
        'Use the portfolio snapshot as private user data and do not invent portfolio numbers.',
        'Use web search only for current market/news context.',
        'Do not provide buy/sell instructions, price targets, tax advice, or legal advice.',
        'Cite external news or market sources inline when you use them.',
        'Keep the report readable, practical, and skeptical about causal claims.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        'Create a daily portfolio report in Markdown with these sections:',
        '1. Portfolio Snapshot',
        '2. Main Drivers',
        '3. Relevant News Context',
        '4. FX and Macro Notes',
        '5. Risks to Watch',
        '6. Data Quality Notes',
        '',
        'Portfolio snapshot JSON:',
        JSON.stringify(snapshot, null, 2)
      ].join('\n')
    }
  ];
}

function buildChatGptReportPrompt(snapshot) {
  return [
    'Please create a daily portfolio report from the private portfolio snapshot below.',
    'The research topic is already specified: this portfolio snapshot. Do not produce a generic deep-research planning template, topic-selection guide, or clarification questionnaire.',
    'Start the report directly.',
    '',
    'Instructions:',
    '- Use the snapshot numbers as authoritative. Do not invent portfolio values.',
    '- Use web/news search for current market context if available in this ChatGPT chat.',
    '- Cite news or market sources with links when you use them.',
    '- Do not provide buy/sell instructions, price targets, tax advice, or legal advice.',
    '- Keep causal language cautious: say news may be relevant, not that it definitely caused a move.',
    '',
    'Report sections:',
    '1. Portfolio Snapshot',
    '2. Main Drivers',
    '3. Relevant News Context',
    '4. FX and Macro Notes',
    '5. Risks to Watch',
    '6. Data Quality Notes',
    '',
    'Portfolio snapshot JSON:',
    JSON.stringify(snapshot, null, 2)
  ].join('\n');
}

function buildChineseChatGptReportPrompt(snapshot) {
  return [
    '请根据下面的私人投资组合快照生成一份每日投资组合报告。',
    '研究主题已经明确：就是这份投资组合快照。不要输出通用的“深度研究选题澄清”“研究方案生成”“资料清单模板”或问题清单。',
    '请直接开始写投资组合报告。',
    '',
    '要求：',
    '- 快照中的数字是权威数据。不要编造投资组合数值。',
    '- 如果当前 ChatGPT 对话支持联网/新闻搜索，请用它补充最新市场背景。',
    '- 使用新闻或市场信息时，请附上来源链接。',
    '- 不要给出买入/卖出指令、目标价、税务建议或法律建议。',
    '- 对原因判断保持谨慎：可以说某些新闻“可能相关”，不要断言它一定导致了涨跌。',
    '- 报告语言使用简体中文。',
    '- 金额默认按 JPY（日元）理解；如果涉及 USD 或汇率，请明确标注。',
    '',
    '报告结构：',
    '1. 投资组合概览',
    '2. 主要变动因素',
    '3. 相关新闻背景',
    '4. 汇率与宏观环境',
    '5. 需要关注的风险',
    '6. 数据质量说明',
    '',
    '投资组合快照 JSON：',
    JSON.stringify(snapshot, null, 2)
  ].join('\n');
}

function buildJapaneseChatGptReportPrompt(snapshot) {
  return [
    '以下の非公開ポートフォリオ・スナップショットを使って、日次ポートフォリオレポートを作成してください。',
    '研究テーマはすでに指定されています。このポートフォリオ・スナップショットです。一般的な深掘り調査のテーマ整理、調査計画テンプレート、確認質問リストは出力しないでください。',
    'すぐにポートフォリオレポート本文を書き始めてください。',
    '',
    '指示：',
    '- スナップショット内の数値を正として扱ってください。ポートフォリオ数値を推測で作らないでください。',
    '- この ChatGPT チャットでWeb/ニュース検索が使える場合は、最新の市場背景を補足してください。',
    '- ニュースや市場情報を使う場合は、出典リンクを付けてください。',
    '- 売買指示、目標株価、税務アドバイス、法的アドバイスはしないでください。',
    '- 因果関係は慎重に表現してください。「関連している可能性がある」とし、値動きの原因だと断定しないでください。',
    '- レポートは日本語で書いてください。',
    '- 金額は原則 JPY（円）として扱い、USD や為替が関係する場合は明記してください。',
    '',
    'レポート構成：',
    '1. ポートフォリオ概況',
    '2. 主な変動要因',
    '3. 関連ニュース背景',
    '4. 為替・マクロ環境',
    '5. 注視すべきリスク',
    '6. データ品質メモ',
    '',
    'ポートフォリオ・スナップショット JSON：',
    JSON.stringify(snapshot, null, 2)
  ].join('\n');
}

function generateDailyReport(snapshot, callback) {
  var input = buildDailyReportMessages(snapshot);

  postJson('/v1/responses', {
    model: DEFAULT_MODEL,
    input: input,
    tools: [{ type: DEFAULT_WEB_SEARCH_TOOL }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources']
  }, function (err, response) {
    if (err) {
      callback(err);
      return;
    }

    var markdown = extractText(response);
    if (!markdown) {
      callback(new Error('OpenAI response did not include report text.'));
      return;
    }

    callback(null, {
      markdown: markdown,
      sources: extractSources(response),
      model: response.model || DEFAULT_MODEL,
      responseId: response.id || '',
      rawResponse: response
    });
  });
}

module.exports = {
  generateDailyReport: generateDailyReport,
  buildChatGptReportPrompt: buildChatGptReportPrompt,
  buildChineseChatGptReportPrompt: buildChineseChatGptReportPrompt,
  buildJapaneseChatGptReportPrompt: buildJapaneseChatGptReportPrompt,
  buildDailyReportMessages: buildDailyReportMessages,
  extractText: extractText,
  extractSources: extractSources
};
