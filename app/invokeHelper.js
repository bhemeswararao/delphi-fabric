const helper = require('./helper');

const LogUtil = require('../common/nodejs/logger');
const logger = LogUtil.new('invokeHelper', true);
const {proposalStringify, proposalFlatten} = require('../common/nodejs/chaincode');
const {invoke, query} = require('./chaincodeHelper');
const channelName = 'allchannel';

const Eventhub = require('../common/nodejs/eventHub');

const {sleep} = require('khala-nodeutils/helper');
exports.invoke = async (peers, clientPeerOrg, chaincodeId, fcn, args = [], transientMap, commitPeers = []) => {
	logger.debug('invoke', 'client org', clientPeerOrg);
	const client = helper.getOrgAdmin(clientPeerOrg);
	const channel = helper.prepareChannel(channelName, client, true);
	let eventHubs = undefined;
	if (commitPeers.length > 0) {
		eventHubs = commitPeers.map(peer => new Eventhub(channel, peer));
		for (const eventHub of eventHubs) {
			await eventHub.connect();
		}
	}
	const {proposalResponses} = await invoke(channel, peers, {
		chaincodeId,
		fcn,
		args,
		transientMap
	}, undefined, eventHubs);
	const result = proposalResponses.map((entry) => proposalFlatten(proposalStringify(entry)));
	logger.debug('invoke', result);
	return result;
};
exports.query = async (peers, clientOrg, chaincodeId, fcn, args = [], transientMap, rawPayload) => {
	logger.debug('query', 'client org', clientOrg);
	const client = helper.getOrgAdmin(clientOrg);
	const channel = helper.prepareChannel(channelName, client, true);
	const {proposalResponses} = await query(channel, peers, {chaincodeId, fcn, args, transientMap});
	return proposalResponses.map((entry) => proposalFlatten(rawPayload ? entry : proposalStringify(entry)));
};
exports.listenChaincodeEvent = async (peer, clientPeerOrg, chaincodeId, eventName = /event/i, onSuccess) => {
	const logger = LogUtil.new('chaincode event', true);
	const client = helper.getOrgAdmin(clientPeerOrg);
	const channel = helper.prepareChannel(channelName, client, true);
	const eventHub = new Eventhub(channel, peer);
	await eventHub.connect();
	const validator = (data) => {
		logger.debug('default validator', data);
		return {valid: true, interrupt: false};
	};
	return eventHub.chaincodeEvent(validator, {chaincodeId, eventName}, onSuccess, (err) => {
		logger.error('onError', err);
	});
};

const looper = async (opts = {interval: 1000}, task, ...taskParams) => {
	const {times, interval} = opts;

	if (Number.isInteger(times)) {
		for (let i = 0; i < times; i++) {
			await task(...taskParams);
			await sleep(interval);
		}
	} else {
		await task(...taskParams);
		await sleep(interval);
		await looper(opts, task, ...taskParams);
	}
};
exports.looper = looper;
