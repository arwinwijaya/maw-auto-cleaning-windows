'use strict';

const crypto = require('node:crypto');

/**
 * Deterministic, collision-resistant node id derived from a filesystem path.
 * Kept short so tree responses stay compact; 16 hex chars (64 bits) is ample
 * for the tens of thousands of directories a single scan can hold.
 *
 * @param {string} nodePath
 * @returns {string}
 */
function nodeId(nodePath) {
  return crypto.createHash('sha1').update(String(nodePath)).digest('hex').slice(0, 16);
}

/**
 * In-memory registry mapping node ids back to scan nodes. The client never
 * receives filesystem paths it can feed back as ids; it only ever echoes ids
 * that this registry issued for the active scan.
 */
class NodeRegistry {
  constructor() {
    this.byId = new Map();
    this.byPath = new Map();
  }

  register(node) {
    if (!node || typeof node.path !== 'string') return null;
    const id = node.id || nodeId(node.path);
    node.id = id;
    this.byId.set(id, node);
    this.byPath.set(node.path, node);
    return id;
  }

  get(id) {
    return this.byId.get(String(id)) || null;
  }

  getByPath(nodePath) {
    return this.byPath.get(String(nodePath)) || null;
  }

  get size() {
    return this.byId.size;
  }
}

module.exports = { nodeId, NodeRegistry };
