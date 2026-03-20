const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection, StreamType } = require('@discordjs/voice');
const https = require('https');
const http = require('http');
const { Readable } = require('stream');

// ---- Hinglish → English dictionary ----
// Maps common Hinglish words/phrases to English equivalents
const HINGLISH_MAP = {
  // Greetings & common phrases
  'namaste': 'hello', 'namaskar': 'hello', 'kaise ho': 'how are you',
  'kya haal hai': 'how are you', 'kya hal hai': 'how are you',
  'theek hai': 'okay', 'thik hai': 'okay', 'theek': 'okay', 'thik': 'fine',
  'accha': 'good', 'acha': 'good', 'achha': 'good',
  'bahut': 'very', 'bohot': 'very', 'bahot': 'very',
  'shukriya': 'thank you', 'dhanyavaad': 'thank you', 'dhanyawad': 'thank you',
  'alvida': 'goodbye', 'phir milenge': 'see you later',
  'haan': 'yes', 'ha': 'yes', 'haa': 'yes', 'ji': 'yes',
  'nahi': 'no', 'nhi': 'no', 'nahin': 'no',
  'kya': 'what', 'kyon': 'why', 'kyun': 'why', 'kahan': 'where',
  'kab': 'when', 'kaun': 'who', 'kaise': 'how', 'kitna': 'how much',
  'kitne': 'how many',

  // Pronouns & people
  'mein': 'I', 'mai': 'I', 'main': 'I',
  'tum': 'you', 'tu': 'you', 'aap': 'you',
  'hum': 'we', 'woh': 'he', 'wo': 'he',
  'yeh': 'this', 'ye': 'this', 'waha': 'there', 'yaha': 'here', 'yahan': 'here',
  'mera': 'my', 'meri': 'my', 'mere': 'my',
  'tumhara': 'your', 'tumhari': 'your', 'tumhare': 'your',
  'aapka': 'your', 'aapki': 'your', 'aapke': 'your',
  'uska': 'his', 'uski': 'his', 'unka': 'their',
  'hamara': 'our', 'hamari': 'our', 'hamare': 'our',
  'bhai': 'brother', 'behen': 'sister', 'dost': 'friend',
  'yaar': 'friend', 'beta': 'son', 'beti': 'daughter',
  'maa': 'mother', 'baap': 'father', 'papa': 'father', 'mummy': 'mother',
  'chacha': 'uncle', 'chachi': 'aunt', 'bhabhi': 'sister-in-law',
  'log': 'people', 'banda': 'guy', 'ladka': 'boy', 'ladki': 'girl',

  // Common verbs / verb roots
  'hai': 'is', 'hain': 'are', 'tha': 'was', 'thi': 'was', 'the': 'were',
  'ho': 'are', 'hoga': 'will be', 'hogi': 'will be',
  'kar': 'do', 'karo': 'do', 'karna': 'to do', 'karta': 'does', 'karti': 'does',
  'karenge': 'will do', 'karunga': 'will do', 'karungi': 'will do',
  'bol': 'say', 'bolo': 'say', 'bolna': 'to say', 'bola': 'said', 'boli': 'said',
  'ja': 'go', 'jao': 'go', 'jana': 'to go', 'jata': 'goes', 'jati': 'goes',
  'jayenge': 'will go', 'jaunga': 'will go', 'jaungi': 'will go', 'gaya': 'went', 'gayi': 'went',
  'aa': 'come', 'aao': 'come', 'aana': 'to come', 'aata': 'comes', 'aati': 'comes',
  'aaya': 'came', 'aayi': 'came', 'aayenge': 'will come',
  'dekh': 'see', 'dekho': 'look', 'dekhna': 'to see', 'dekha': 'saw',
  'sun': 'listen', 'suno': 'listen', 'sunna': 'to listen', 'suna': 'heard',
  'le': 'take', 'lo': 'take', 'lena': 'to take', 'liya': 'took',
  'de': 'give', 'do': 'give', 'dena': 'to give', 'diya': 'gave',
  'kha': 'eat', 'khao': 'eat', 'khana': 'food', 'khaya': 'ate',
  'pi': 'drink', 'piyo': 'drink', 'pina': 'to drink', 'piya': 'drank',
  'rakh': 'keep', 'rakho': 'keep', 'rakhna': 'to keep', 'rakha': 'kept',
  'samajh': 'understand', 'samjho': 'understand', 'samjha': 'understood',
  'chal': 'walk', 'chalo': 'lets go', 'chalna': 'to walk',
  'baith': 'sit', 'baitho': 'sit', 'baithna': 'to sit',
  'soch': 'think', 'socho': 'think', 'sochna': 'to think', 'socha': 'thought',
  'bata': 'tell', 'batao': 'tell', 'batana': 'to tell', 'bataya': 'told',
  'pata': 'know', 'maloom': 'know', 'jaanta': 'know', 'jaante': 'know',
  'chahiye': 'want', 'chahie': 'want', 'chahta': 'want', 'chahti': 'want',
  'manga': 'ordered', 'mangna': 'to ask for',
  'ruk': 'stop', 'ruko': 'stop', 'rukna': 'to stop',
  'padh': 'read', 'padho': 'read', 'padhna': 'to study', 'padha': 'studied',
  'likh': 'write', 'likho': 'write', 'likhna': 'to write', 'likha': 'wrote',
  'mil': 'meet', 'milo': 'meet', 'milna': 'to meet', 'mila': 'met',
  'bhej': 'send', 'bhejna': 'to send', 'bheja': 'sent',
  'lag': 'feel', 'lagta': 'seems', 'lagti': 'seems', 'laga': 'felt',
  'sakta': 'can', 'sakti': 'can', 'sakte': 'can',
  'raha': 'is doing', 'rahi': 'is doing', 'rahe': 'are doing',

  // Common nouns & adjectives
  'paisa': 'money', 'paise': 'money', 'rupaya': 'rupee', 'rupaye': 'rupees',
  'kaam': 'work', 'ghar': 'home', 'dukan': 'shop', 'jagah': 'place',
  'din': 'day', 'raat': 'night', 'subah': 'morning', 'shaam': 'evening',
  'kal': 'tomorrow', 'aaj': 'today', 'parso': 'day after tomorrow',
  'abhi': 'now', 'baad': 'after', 'pehle': 'before', 'phir': 'then',
  'bada': 'big', 'badi': 'big', 'bade': 'big',
  'chhota': 'small', 'chhoti': 'small', 'chhote': 'small',
  'naya': 'new', 'nayi': 'new', 'naye': 'new',
  'purana': 'old', 'purani': 'old', 'purane': 'old',
  'acchi': 'good', 'bura': 'bad', 'buri': 'bad',
  'khush': 'happy', 'udaas': 'sad', 'gussa': 'angry',
  'waqt': 'time', 'samay': 'time',
  'sab': 'all', 'sabhi': 'everyone', 'kuch': 'some', 'koi': 'someone',
  'bahut': 'very much', 'zyada': 'more', 'kam': 'less',
  'saath': 'with', 'bina': 'without', 'ke': 'of',
  'aur': 'and', 'ya': 'or', 'lekin': 'but', 'par': 'but', 'magar': 'but',
  'kyunki': 'because', 'isliye': 'therefore', 'agar': 'if', 'toh': 'then',
  'warna': 'otherwise', 'jab': 'when', 'tab': 'then',
  'bas': 'enough', 'bilkul': 'absolutely', 'sach': 'true', 'jhooth': 'lie',
  'pyar': 'love', 'mohabbat': 'love', 'dil': 'heart',
  'zindagi': 'life', 'duniya': 'world', 'khwab': 'dream',
  'raasta': 'path', 'safar': 'journey',
  'paani': 'water', 'chai': 'tea', 'doodh': 'milk', 'roti': 'bread',
  'cheez': 'thing', 'cheezein': 'things',

  // Expressions / slang
  'chillao mat': 'do not shout', 'fikar mat karo': 'do not worry',
  'koi baat nahi': 'no problem', 'koi nahi': 'no one',
  'mujhe': 'to me', 'tujhe': 'to you', 'humein': 'to us', 'unhe': 'to them',
  'wapas': 'back', 'dobara': 'again', 'zaroor': 'definitely', 'shayad': 'maybe',
  'bohot badiya': 'very good', 'mast': 'awesome', 'zabardast': 'amazing',
  'kamaal': 'amazing', 'bakwas': 'nonsense', 'faltu': 'useless',
  'bindaas': 'carefree', 'jugaad': 'a workaround', 'dhamaal': 'blast',
  'patao': 'impress', 'chill kar': 'relax', 'chill': 'relax',

  // Postpositions / particles
  'mein': 'in', 'pe': 'on', 'par': 'on', 'se': 'from', 'ko': 'to',
  'ka': 'of', 'ki': 'of', 'ke': 'of', 'tak': 'until', 'ne': '',
  'wala': 'one who', 'wali': 'one who', 'wale': 'ones who',
};

// Pre-sort by length descending so longer phrases match first
const SORTED_PHRASES = Object.keys(HINGLISH_MAP)
  .sort((a, b) => b.length - a.length);

/**
 * Translate Hinglish text to English.
 * Pass-through words that are already English or unmapped.
 */
function translateHinglish(text) {
  let result = text.toLowerCase().trim();

  // First pass: replace multi-word phrases
  for (const phrase of SORTED_PHRASES) {
    if (phrase.includes(' ')) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      result = result.replace(regex, HINGLISH_MAP[phrase]);
    }
  }

  // Second pass: replace single words
  const words = result.split(/\s+/);
  const translated = words.map(word => {
    // Strip punctuation for lookup, re-attach after
    const match = word.match(/^([^a-z]*)([a-z]+)([^a-z]*)$/i);
    if (!match) return word;
    const [, pre, core, post] = match;
    const lower = core.toLowerCase();
    if (HINGLISH_MAP[lower]) {
      return pre + HINGLISH_MAP[lower] + post;
    }
    return word; // Pass through (already English or unknown)
  });

  let english = translated.join(' ');

  // Capitalize first letter of each sentence
  english = english.replace(/(^|\.\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  if (english.length > 0) {
    english = english.charAt(0).toUpperCase() + english.slice(1);
  }

  return english;
}

/**
 * Fetch TTS audio as a buffer from Google Translate's TTS endpoint.
 * Splits long text into 200-char chunks (Google's limit per request).
 */
async function fetchTTSAudio(text, lang = 'en') {
  // Clean and limit text
  const cleanText = text.replace(/[^\w\s.,!?;:'"()\-]/g, ' ').trim().slice(0, 1000);
  if (!cleanText) return null;

  // Split into chunks respecting word boundaries
  const chunks = [];
  let remaining = cleanText;
  while (remaining.length > 0) {
    if (remaining.length <= 200) {
      chunks.push(remaining);
      break;
    }
    // Find a good break point
    let breakPoint = remaining.lastIndexOf(' ', 200);
    if (breakPoint < 50) breakPoint = 200;
    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  const audioBuffers = [];
  for (const chunk of chunks) {
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encoded}`;

    const buffer = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://translate.google.com/',
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          const redirectUrl = res.headers.location;
          const mod = redirectUrl.startsWith('https') ? https : http;
          mod.get(redirectUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
          }, (res2) => {
            const data = [];
            res2.on('data', c => data.push(c));
            res2.on('end', () => resolve(Buffer.concat(data)));
            res2.on('error', reject);
          }).on('error', reject);
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`TTS HTTP ${res.statusCode}`));
        }
        const data = [];
        res.on('data', c => data.push(c));
        res.on('end', () => resolve(Buffer.concat(data)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('TTS request timeout')); });
    });

    if (buffer && buffer.length > 0) {
      audioBuffers.push(buffer);
    }
  }

  if (audioBuffers.length === 0) return null;
  return Buffer.concat(audioBuffers);
}

// Per-guild TTS player state (separate from music to avoid conflicts)
const ttsPlayers = new Map();

function getTTSPlayer(guildId) {
  return ttsPlayers.get(guildId) || null;
}

function cleanupTTS(guildId) {
  const state = ttsPlayers.get(guildId);
  if (state) {
    try { state.player.stop(); } catch (_) {}
    // Don't destroy the voice connection if music player is using it
    ttsPlayers.delete(guildId);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Text-to-speech with Hinglish → English translation')
    .addSubcommand(sub =>
      sub.setName('say')
        .setDescription('Translate Hinglish text to English and play it in voice chat')
        .addStringOption(opt =>
          opt.setName('text')
            .setDescription('Hinglish or English text to speak aloud')
            .setRequired(true)
            .setMaxLength(1000))
        .addStringOption(opt =>
          opt.setName('language')
            .setDescription('Output voice language (default: English)')
            .setRequired(false)
            .addChoices(
              { name: 'English', value: 'en' },
              { name: 'Hindi', value: 'hi' },
              { name: 'Spanish', value: 'es' },
              { name: 'French', value: 'fr' },
              { name: 'German', value: 'de' },
              { name: 'Japanese', value: 'ja' },
            )))
    .addSubcommand(sub =>
      sub.setName('translate')
        .setDescription('Show the Hinglish → English translation without playing audio')
        .addStringOption(opt =>
          opt.setName('text')
            .setDescription('Hinglish text to translate')
            .setRequired(true)
            .setMaxLength(1000)))
    .addSubcommand(sub =>
      sub.setName('stop')
        .setDescription('Stop TTS playback')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── stop ──
    if (subcommand === 'stop') {
      cleanupTTS(guildId);
      return interaction.reply({ content: '🔇 TTS stopped.', ephemeral: true });
    }

    // ── translate (text only, no audio) ──
    if (subcommand === 'translate') {
      const inputText = interaction.options.getString('text');
      const translated = translateHinglish(inputText);

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('🗣️ Hinglish → English Translation')
        .addFields(
          { name: '📝 Original (Hinglish)', value: inputText.slice(0, 1024) },
          { name: '🔄 Translation (English)', value: translated.slice(0, 1024) }
        )
        .setFooter({ text: `Translated by DisCryptoBank • Requested by ${interaction.user.username}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── say (translate + play in voice) ──
    if (subcommand === 'say') {
      const inputText = interaction.options.getString('text');
      const lang = interaction.options.getString('language') || 'en';

      // User must be in a voice channel
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ You need to be in a voice channel to use TTS.', ephemeral: true });
      }

      await interaction.deferReply();

      // Translate Hinglish → English (for English output)
      const translated = lang === 'en' ? translateHinglish(inputText) : inputText;
      const displayTranslated = translateHinglish(inputText); // Always show English translation

      // Fetch TTS audio
      let audioBuffer;
      try {
        audioBuffer = await fetchTTSAudio(translated, lang);
      } catch (err) {
        console.error('[TTS] Audio fetch error:', err.message);
        return interaction.editReply({ content: '❌ Failed to generate speech audio. Try again.' });
      }

      if (!audioBuffer || audioBuffer.length < 100) {
        return interaction.editReply({ content: '❌ Could not generate speech audio for that text.' });
      }

      // Get or create voice connection
      let connection = getVoiceConnection(guildId);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: false,
        });

        // Handle disconnection
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await Promise.race([
              entersState(connection, VoiceConnectionStatus.Signalling, 5000),
              entersState(connection, VoiceConnectionStatus.Connecting, 5000),
            ]);
          } catch {
            cleanupTTS(guildId);
            try { connection.destroy(); } catch (_) {}
          }
        });
      }

      // Create a dedicated TTS audio player (separate from music)
      let state = getTTSPlayer(guildId);
      if (!state) {
        state = {
          player: createAudioPlayer(),
          connection,
        };
        ttsPlayers.set(guildId, state);
      }
      state.connection = connection;

      // Subscribe connection to TTS player
      connection.subscribe(state.player);

      // Create audio resource from the MP3 buffer
      const stream = Readable.from(audioBuffer);
      const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

      // Play audio
      state.player.play(resource);

      // Auto-cleanup when playback finishes
      state.player.once(AudioPlayerStatus.Idle, () => {
        // If there's a music player for this guild, re-subscribe to it
        try {
          const musicPlayer = require('../utils/musicPlayer');
          const musicState = musicPlayer.getGuildPlayer(guildId);
          if (musicState && musicState.connection) {
            musicState.connection.subscribe(musicState.player);
          }
        } catch (_) {}
        cleanupTTS(guildId);
      });

      // Build response embed
      const isHinglish = displayTranslated.toLowerCase() !== inputText.toLowerCase();
      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('🔊 Text-to-Speech')
        .setDescription(`Now playing in **${voiceChannel.name}**`)
        .setFooter({ text: `DisCryptoBank TTS • Requested by ${interaction.user.username}` })
        .setTimestamp();

      if (isHinglish) {
        embed.addFields(
          { name: '📝 Original (Hinglish)', value: inputText.slice(0, 1024) },
          { name: '🔄 Translated (English)', value: displayTranslated.slice(0, 1024) }
        );
      } else {
        embed.addFields(
          { name: '📝 Text', value: inputText.slice(0, 1024) }
        );
      }

      const langNames = { en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese' };
      embed.addFields({ name: '🗣️ Voice', value: langNames[lang] || 'English', inline: true });

      return interaction.editReply({ embeds: [embed] });
    }
  },

  // Export for potential reuse
  translateHinglish,
  fetchTTSAudio,
};
