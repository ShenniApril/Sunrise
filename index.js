// pages/index/index.js
// 聊天首页：预留 Coze 云函数 + NFC + 拍照入口

Page({
  data: {
    inputValue: '',
    messages: [
      {
        role: 'ai',
        text: '【序章】\n阴雨后的松江街巷，霓虹尚未点亮。阁下，请报上名号。'
      }
    ],
    // 当前一轮由 Coze 返回的可选行动
    currentChoices: [],
    // 玩家三条属性的累积状态（前端自行累加）
    playerState: {
      career: 0,
      love: 0,
      power: 0
    }
  },

  // 监听输入框变化
  onInputChange(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },

  // 发送按钮 / 键盘回车
  onSend() {
    const text = (this.data.inputValue || '').trim();
    if (!text) return;

    const userMsg = {
      role: 'user',
      text
    };

    // 先追加玩家消息
    this.appendMessage(userMsg);
    this.setData({ inputValue: '' });

    // 统一通过 callCoze 走 Coze / 假数据流程
    this.callCoze({ text });
  },

  // 追加一条消息到列表
  appendMessage(msg) {
    const messages = this.data.messages.concat(msg);
    this.setData({
      messages
    });
  },

  // 处理来自 Coze 的 JSON 结构回复
  handleCozeReply(cozeRaw) {
    let cozeObj = cozeRaw;
    if (typeof cozeRaw === 'string') {
      try {
        cozeObj = JSON.parse(cozeRaw);
      } catch (e) {
        console.error('无法解析 Coze JSON，原始内容：', cozeRaw, e);
        return;
      }
    }

    if (!cozeObj || typeof cozeObj !== 'object') {
      console.warn('Coze 返回内容不是对象，忽略：', cozeObj);
      return;
    }

    const narration = cozeObj.narration || '';
    const npcDialogue = Array.isArray(cozeObj.npc_dialogue)
      ? cozeObj.npc_dialogue
      : [];
    const choices = Array.isArray(cozeObj.choices) ? cozeObj.choices : [];
    const delta = cozeObj.player_state_delta || {};

    const newMessages = [];

    if (narration) {
      newMessages.push({
        role: 'ai',
        text: narration
      });
    }

    npcDialogue.forEach((d) => {
      if (!d || !d.text) return;
      const speaker = d.speaker || '某人';
      newMessages.push({
        role: 'ai',
        text: speaker + '：' + d.text
      });
    });

    const messages = this.data.messages.concat(newMessages);

    // 累加玩家属性
    const playerState = Object.assign({}, this.data.playerState);
    ['career', 'love', 'power'].forEach((key) => {
      const v = Number(delta[key] || 0);
      if (!Number.isNaN(v)) {
        const origin = Number(playerState[key] || 0);
        playerState[key] = origin + v;
      }
    });

    this.setData({
      messages,
      currentChoices: choices,
      playerState
    });
  },

  // 实际调用 Coze 的入口（当前保留假数据逻辑，方便本地直接跑起来）
  callCoze(payload) {
    const text = payload && payload.text;

    // 如果还没初始化云能力，就直接走假数据
    if (!wx.cloud) {
      console.warn('当前未初始化云能力，直接使用 Coze JSON 假数据回复');
      const mock = this.buildMockCozeJson(text);
      this.handleCozeReply(mock);
      return;
    }

    wx.cloud.callFunction({
      name: 'callCoze',
      data: payload,
      success: (res) => {
        // 期望云函数返回形如 { reply: <Coze JSON 对象或字符串> }
        const reply =
          (res && res.result && res.result.reply) || null;

        if (!reply) {
          console.warn('云函数返回中未找到 reply 字段，改用假数据');
          const mock = this.buildMockCozeJson(text);
          this.handleCozeReply(mock);
          return;
        }

        this.handleCozeReply(reply);
      },
      fail: (err) => {
        console.error('callCoze 调用失败，将使用 Coze JSON 假数据回复：', err);
        const mock = this.buildMockCozeJson(text);
        this.handleCozeReply(mock);
      }
    });
  },

  // 生成一条符合 Coze System Prompt 约定结构的本地假数据
  buildMockCozeJson(userText) {
    const safeText = userText || '……';
    return {
      narration: `【假数据】\n阴雨未尽的松江街巷，你低声说道：「${safeText}」。\n线人抬眼打量了你一瞬，似笑非笑，什么也没说。`,
      npc_dialogue: [
        {
          speaker: '线人',
          text: '等真正接上 Coze 之后，阁下说的每一句话，都会被好好记在案头。'
        }
      ],
      choices: [
        {
          id: 'CHOICE_001',
          label: '继续与线人交谈',
          hint: 'dev_only_mock_choice'
        }
      ],
      player_state_delta: {
        career: 0,
        love: 0,
        power: 0
      }
    };
  },

  // 本地假数据回复逻辑（可按需替换成更有氛围的内容）
  appendMockReply(userText) {
    const reply = `【假数据】你刚才说：「${userText}」。\n\n` +
      '真正接入 Coze 后，这里会根据民国剧本和你的选择，给出一段氛围感叙事与对话。';
    this.appendMessage({
      role: 'ai',
      text: reply
    });
  },

  // 选项按钮点击：将选项视为一次「玩家行动」，继续推进 Coze 剧情
  onChoiceTap(e) {
    const dataset = e.currentTarget.dataset || {};
    const choiceId = dataset.id;
    const label = dataset.label || '做出了一个选择';

    // 把玩家选择也作为一条 user 消息插入对话流
    this.appendMessage({
      role: 'user',
      text: label
    });

    // 清空当前选项，避免重复点击
    this.setData({
      currentChoices: []
    });

    // 将 choice_id 一并传给后端 / Coze，方便在 System Prompt 或工具中区分分支
    this.callCoze({
      text: label,
      choice_id: choiceId
    });
  },

  // NFC 预留入口
  onTapNFC() {
    console.log('NFC 按钮被点击，后续在此处接入 wx.getNFCAdapter。');
    wx.showToast({
      title: 'NFC 功能待接入',
      icon: 'none'
    });
  },

  // 拍照提交线索入口
  onTapPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        const path = file ? file.tempFilePath : '';
        console.log('选择的图片路径：', path);
        wx.showToast({
          title: '已选图片，控制台查看路径',
          icon: 'none'
        });
      },
      fail: (err) => {
        console.error('chooseMedia 调用失败：', err);
      }
    });
  }
});

