const map = require('lib0/dist/map.cjs')
const {ChangeSet, Text} = require("@codemirror/state")
const http = require("http")
const {uuidv4} = require("lib0/random");
const socketIo = require("socket.io");

const idToDoc = new Map();

class Doc {
  constructor(docName, namespace, notifyNewPeers, sendToPeer) {
    this.docName = docName
    // The updates received so far (updates.length gives the current version)
    this.updates = []
    this.namespace = namespace
    this.shellUpdates = []
    this.doc = Text.of([""])
    this.peerInfo = new Map()
    this.notifyNewPeers = notifyNewPeers
    this.sendToPeer = sendToPeer
  }
}

const docs = new Map()
const host = process.env.HOST || '0.0.0.0'
const port = process.env.PORT || 3000

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

const io = new socketIo.Server(server);

const broadcast = (docname, channel, message = {}) => {
  try {
    io.to(docname).emit(channel, message)
  } catch (e) {
    return false;
  }
}

const notifyNewPeers = (docname) => {
  broadcast(docname, "newPeers")
}

const notifyNewUpdates = (docname) => {
  broadcast(docname, "newUpdates")
}

const sendToPeer = (to, channel, message = {}) => {
  try {
    io.to(to).emit(channel, message)
    return true;
  } catch (e) {
    return false;
  }
}

const getPeers = (doc, id) => {
  return {
    selfid: id,
    ids: Object.fromEntries(doc.peerInfo)
  }
}

const pushUpdates = (doc, data) => {
  if (data.version !== doc.updates.length) {
    return false;
  } else {
    for (let update of data.updates) {
      // Convert the JSON representation to an actual ChangeSet
      // instance
      let changes = ChangeSet.fromJSON(update.changes)
      doc.updates.push({changes, clientID: update.clientID})
      doc.doc = changes.apply(doc.doc)
    }
    notifyNewUpdates(doc.docName)
    return true;
  }
}

const pushShellUpdates = (doc, data) => {
  if (data.shellVersion !== doc.shellUpdates.length) {
    return false;
  } else {
    Array.prototype.push.apply(doc.shellUpdates, data.shellUpdates)
    notifyNewUpdates(doc.docName)
    return true;
  }
}

const pullUpdates = (doc, data) => {
  let ret = {
    updates: [],
    shellUpdates: []
  }
  if (data.version < doc.updates.length) {
    ret.updates = doc.updates.slice(data.version);
  }
  if (data.shellVersion < doc.shellUpdates.length) {
    ret.shellUpdates = doc.shellUpdates.slice(data.shellVersion)
  }
  return ret;
}

const getDoc = (docname) => map.setIfUndefined(docs, docname, () => {
  return new Doc(docname, io, notifyNewPeers, sendToPeer)
})

io.on("connection", (socket) => {
  const docName = socket.handshake.query.docName

  socket.join(docName)

  idToDoc.set(socket.id, docName)
  const doc = getDoc(docName)

  doc.peerInfo.set(socket.id, {
    color: socket.handshake.query.color,
    colorlight: socket.handshake.query.colorlight,
    name: socket.handshake.query.username
  })

  doc.notifyNewPeers(docName)

  socket.on("disconnect", () => {
    const docName = idToDoc.get(socket.id)
    idToDoc.delete(socket.id)
    const doc = getDoc(docName)
    doc.peerInfo.delete(socket.id)
    doc.notifyNewPeers(docName)
  })

  socket.on("getPeers", (data, callback) => {
    const result = getPeers(doc, socket.id)
    callback(result)
  })

  socket.on("pushUpdates", (data, callback) => {
    const result = pushUpdates(doc, data)
    callback(result)
  })

  socket.on("pushShellUpdates", (data, callback) => {
    const result = pushShellUpdates(doc, data)
    callback(result)
  })

  socket.on("pullUpdates", (data, callback) => {
    const result = pullUpdates(doc, data)
    callback(result)
  })

  socket.on("ping", (data, callback) => {
    callback(true)
  })

  socket.on("sendToPrivate", (data) => {
    sendToPeer(data.to, data.channel, data.message)
    return true;
  })
})

server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`)
})