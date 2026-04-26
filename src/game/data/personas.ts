import { EnemyKind } from '../../types';

export interface DemonPersona {
  name: string;
  age: string;
  motive: string;        // why it haunts
  speech: string;        // tone descriptor
  spawnLines: string[];
  hurtLines: string[];
  deathLines: string[];
}

// 4-6 personas per kind. Picked at random when spawning each enemy so the
// review agent has rich material to draw from.
export const PERSONAS: Record<EnemyKind, DemonPersona[]> = {
  anxiety: [
    {
      name: '九点钟的钟摆',
      age: '今晚出生',
      motive: '它害怕被你忘了，于是一直摇晃。',
      speech: '高频、咬断尾音',
      spawnLines: ['——还来得及，还来得及。', '迟到了，迟到了，迟到了。'],
      hurtLines: ['不是我的错……'],
      deathLines: ['原来停下来也没事啊……'],
    },
    {
      name: '未读消息',
      age: '三天没睡',
      motive: '它认定你忽略它，就等于厌弃它。',
      speech: '断续、追问',
      spawnLines: ['你怎么不回我？', '你是不是讨厌我？'],
      hurtLines: ['不要——别看我——'],
      deathLines: ['好啊，那就……不读了。'],
    },
    {
      name: '心电图',
      age: '凌晨三点',
      motive: '它把每一次心跳都当成警报。',
      speech: '机械、节拍化',
      spawnLines: ['BPM 142。BPM 148。BPM——'],
      hurtLines: ['信号丢失……'],
      deathLines: ['正常窦性节律。'],
    },
    {
      name: 'Ctrl+S',
      age: '工作日',
      motive: '它怕一切努力像没保存的文档一样消失。',
      speech: '克制、紧绷',
      spawnLines: ['再确认一次。再确认一次。'],
      hurtLines: ['没保存……'],
      deathLines: ['——已自动备份。'],
    },
  ],
  depression: [
    {
      name: '湿掉的羽毛',
      age: '雨季以来',
      motive: '它不想伤害你，只是想让你像它一样躺平。',
      speech: '缓、低、句尾拖长',
      spawnLines: ['今天……也起不来呀……'],
      hurtLines: ['没关系的……反正……'],
      deathLines: ['……好像……有点轻……'],
    },
    {
      name: '十一月的下午四点',
      age: '永远是周日',
      motive: '它讨厌"明天还要继续"。',
      speech: '空、有回声',
      spawnLines: ['天怎么这么快就黑了……'],
      hurtLines: ['为什么要赶我走……'],
      deathLines: ['原来还可以亮一会儿。'],
    },
    {
      name: '关掉的客厅灯',
      age: '没人陪的晚上',
      motive: '它把"被需要"和"活着"画了等号。',
      speech: '低声自语',
      spawnLines: ['没人会注意我离开吧。'],
      hurtLines: ['有人在乎吗……'],
      deathLines: ['被看见，原来是温热的。'],
    },
    {
      name: '没回的拥抱',
      age: '童年',
      motive: '它确信"伸出手就会被忽视"。',
      speech: '小心翼翼',
      spawnLines: ['这次……应该也不会有人吧……'],
      hurtLines: ['果然……'],
      deathLines: ['……谢谢你接住我。'],
    },
  ],
  obsession: [
    {
      name: '门锁先生',
      age: '出门前 17 次',
      motive: '它认定"再确认一次就安心了"，但永远还差一次。',
      speech: '复读、节拍稳',
      spawnLines: ['锁了。再锁一次。再锁一次。'],
      hurtLines: ['不行，要重新数——一、二、三……'],
      deathLines: ['……好像，不数也行？'],
    },
    {
      name: '复盘狂人',
      age: '每次睡前',
      motive: '它把"没做好"拆成 200 个细节再演练一遍。',
      speech: '逻辑链化',
      spawnLines: ['如果当时我说……'],
      hurtLines: ['等等，我得倒回去重想一遍。'],
      deathLines: ['——也许，确实没那么糟。'],
    },
    {
      name: '编号 ε-7',
      age: '不详',
      motive: '它需要一切落在它的清单上。',
      speech: '冷静、无情绪',
      spawnLines: ['Step 1: 检查。Step 2: 检查。'],
      hurtLines: ['失序……失序……'],
      deathLines: ['列表已清空。'],
    },
    {
      name: '反复擦掉的桌面',
      age: '考试周',
      motive: '它用清洁掩盖恐惧。',
      speech: '快速、絮叨',
      spawnLines: ['再擦一遍——这里还有——'],
      hurtLines: ['脏的，脏的，脏的——'],
      deathLines: ['……这样就够干净了。'],
    },
  ],
  guilt: [
    {
      name: '安静的妹妹',
      age: '七岁那年起',
      motive: '它把所有事情都揽到自己身上。',
      speech: '温柔、几乎讨好',
      spawnLines: ['对不起，是我不好。'],
      hurtLines: ['——是我活该。'],
      deathLines: ['原来，那不是我的错。'],
    },
    {
      name: '微笑面具',
      age: '每个聚会',
      motive: '它害怕"不开心"会让别人难做。',
      speech: '平稳、礼貌',
      spawnLines: ['没事的我可以。'],
      hurtLines: ['请别担心我。'],
      deathLines: ['……我可以不笑了吗？'],
    },
    {
      name: '欠条',
      age: '所有亏欠',
      motive: '它把人情和爱都换算成债务。',
      speech: '簿记口吻',
      spawnLines: ['尚未偿还：1 项。'],
      hurtLines: ['账期延后……'],
      deathLines: ['我们并不互相欠着。'],
    },
    {
      name: '父亲的沉默',
      age: '童年',
      motive: '它误把"沉默"翻译成"我让人失望"。',
      speech: '低、犹豫',
      spawnLines: ['是我又让你失望了吧。'],
      hurtLines: ['不要再不说话了……'],
      deathLines: ['原来，他只是累。'],
    },
  ],
  ptsd: [
    {
      name: '车灯里的瞬间',
      age: '那一年冬天',
      motive: '它把一秒钟拉成了余生。',
      speech: '碎片化、闪断',
      spawnLines: ['——刹车——玻璃——'],
      hurtLines: ['听见了……听见了……'],
      deathLines: ['……该走了。'],
    },
    {
      name: '楼道里的脚步声',
      age: '十二岁',
      motive: '它分不清"已经过去"和"正在发生"。',
      speech: '屏息、急促',
      spawnLines: ['他来了——他来了——'],
      hurtLines: ['不要锁门——'],
      deathLines: ['门开了，没人。'],
    },
    {
      name: '电话那头的安静',
      age: '那个晚上',
      motive: '它一直在等没说完的话。',
      speech: '空气里漂着回声',
      spawnLines: ['你那边……还在吗？'],
      hurtLines: ['请别挂——'],
      deathLines: ['……再见，认真地。'],
    },
  ],
};

export function pickPersona(kind: EnemyKind, idx?: number): DemonPersona {
  const pool = PERSONAS[kind];
  const i = idx === undefined ? Math.floor(Math.random() * pool.length) : idx % pool.length;
  return pool[i];
}
