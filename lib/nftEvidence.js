const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC1155_TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const ERC1155_TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

function isTopic(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function topicAddress(topic) {
  return isTopic(topic) ? `0x${topic.slice(-40)}` : null;
}

function parseLogIndex(logIndex) {
  const parsed = typeof logIndex === "string" && /^0x[0-9a-fA-F]+$/.test(logIndex)
    ? Number.parseInt(logIndex, 16)
    : Number.isInteger(logIndex) ? logIndex : null;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function wordAt(data, index) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const start = 2 + index * 64;
  const word = data.slice(start, start + 64);
  return word.length === 64 ? word : null;
}

function uintWord(word) {
  if (!word || !/^[0-9a-fA-F]{64}$/.test(word)) return null;
  return BigInt(`0x${word}`).toString();
}

function decodeUintArray(data, offsetWord) {
  if (!offsetWord) return null;
  const offset = Number(BigInt(`0x${offsetWord}`));
  if (!Number.isSafeInteger(offset) || offset % 32 !== 0) return null;
  const startWord = offset / 32;
  const lengthWord = wordAt(data, startWord);
  if (!lengthWord) return null;
  const length = Number(BigInt(`0x${lengthWord}`));
  if (!Number.isSafeInteger(length) || length < 0 || length > 10000) return null;
  const values = [];
  for (let i = 0; i < length; i += 1) {
    const value = uintWord(wordAt(data, startWord + 1 + i));
    if (value == null) return null;
    values.push(value);
  }
  return values;
}

function decodeErc721(log) {
  if (!Array.isArray(log?.topics) || log.topics.length !== 4) return null;
  if (log.topics[0]?.toLowerCase() !== ERC721_TRANSFER_TOPIC) return null;
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const tokenId = isTopic(log.topics[3]) ? BigInt(log.topics[3]).toString() : null;
  if (!log.address || !from || !to || tokenId == null) return null;
  return { standard: "ERC721", contractAddress: log.address, from, to, tokenId, quantity: "1", logIndex: parseLogIndex(log.logIndex) };
}

function decodeErc1155Single(log) {
  if (!Array.isArray(log?.topics) || log.topics.length !== 4) return null;
  if (log.topics[0]?.toLowerCase() !== ERC1155_TRANSFER_SINGLE_TOPIC) return null;
  const operator = topicAddress(log.topics[1]);
  const from = topicAddress(log.topics[2]);
  const to = topicAddress(log.topics[3]);
  const tokenId = uintWord(wordAt(log.data, 0));
  const quantity = uintWord(wordAt(log.data, 1));
  if (!log.address || !operator || !from || !to || tokenId == null || quantity == null) return null;
  return { standard: "ERC1155", transferType: "SINGLE", contractAddress: log.address, operator, from, to, tokenId, quantity, logIndex: parseLogIndex(log.logIndex) };
}

function decodeErc1155Batch(log) {
  if (!Array.isArray(log?.topics) || log.topics.length !== 4) return null;
  if (log.topics[0]?.toLowerCase() !== ERC1155_TRANSFER_BATCH_TOPIC) return null;
  const operator = topicAddress(log.topics[1]);
  const from = topicAddress(log.topics[2]);
  const to = topicAddress(log.topics[3]);
  const ids = decodeUintArray(log.data, wordAt(log.data, 0));
  const quantities = decodeUintArray(log.data, wordAt(log.data, 1));
  if (!log.address || !operator || !from || !to || !ids || !quantities || ids.length !== quantities.length) return null;
  return ids.map((tokenId, index) => ({ standard: "ERC1155", transferType: "BATCH", batchIndex: index, contractAddress: log.address, operator, from, to, tokenId, quantity: quantities[index], logIndex: parseLogIndex(log.logIndex) }));
}

export function decodeNftTransfers(receipt) {
  const transfers = [];
  for (const log of receipt?.logs || []) {
    const erc721 = decodeErc721(log);
    if (erc721) { transfers.push(erc721); continue; }
    const single = decodeErc1155Single(log);
    if (single) { transfers.push(single); continue; }
    const batch = decodeErc1155Batch(log);
    if (batch) transfers.push(...batch);
  }
  return transfers;
}
