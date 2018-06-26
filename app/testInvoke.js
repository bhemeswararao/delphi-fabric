const {invoke} = require('./chaincodeHelper');
const {reducer} = require('../common/nodejs/chaincode');
const helper = require('./helper');

const logger = require('../common/nodejs/logger').new('testInvoke');
const chaincodeId = process.env.name?process.env.name:'adminChaincode';
const fcn = '';
const args = [];
const peerIndexes = [0];
const orgName = helper.randomOrg('peer');
const channelName = 'allchannel';

const peers = helper.newPeers(peerIndexes, orgName);

const task = async () => {
	const client = await helper.getOrgAdmin(orgName);
	const channel = helper.prepareChannel(channelName, client, true);
	const {txEventResponses, proposalResponses} = await invoke(channel, peers, {chaincodeId, fcn, args});
	const result = reducer({txEventResponses, proposalResponses});
	logger.info(result);
};
exports.run = async (times, interval = 10000) => {
	const {sleep} = require('../common/nodejs/helper');
	if (Number.isInteger(times)) {
		for (let i = 0; i < times; i++) {
			await task();
			await sleep(interval);
		}
	} else {
		await task();
		await sleep(interval);
		await exports.run(times, interval);
	}
};

