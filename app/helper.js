/**
 * Copyright 2017 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an 'AS IS' BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';

const logger = require('../common/nodejs/logger').new('Helper');
const path = require('path');
const globalConfig = require('../config/orgs.json');

const companyConfig = globalConfig;
const orgsConfig = companyConfig.orgs;
const CRYPTO_CONFIG_DIR = globalConfig.docker.volumes.MSPROOT.dir;
const channelsConfig = companyConfig.channels;
const sdkUtils = require('fabric-client/lib/utils');
const nodeConfig = require('./config.json');
const ClientUtil = require('../common/nodejs/client');
const EventHubUtil = require('../common/nodejs/eventHub');
const peerUtil = require('../common/nodejs/peer');
const pathUtil = require('../common/nodejs/path');
const OrdererUtil = require('../common/nodejs/orderer');
const channelUtil = require('../common/nodejs/channel');
const {CryptoPath} = pathUtil;


// peerConfig: "portMap": [{	"host": 8051,		"container": 7051},{	"host": 8053,		"container": 7053}]
const preparePeer = (orgName, peerIndex, peerConfig) => {
	let peerPort;
	let eventHubPort;
	for (const portMapEach of peerConfig.portMap) {
		if (portMapEach.container === 7051) {
			peerPort = portMapEach.host;
		}
		if (portMapEach.container === 7053) {
			eventHubPort = portMapEach.host;
		}
	}
	let peer;
	if (globalConfig.TLS) {

		const peer_hostName_full = `peer${peerIndex}.${orgName}`;
		const cryptoPath = new CryptoPath(CRYPTO_CONFIG_DIR,
			{peer: {name: `peer${peerIndex}`, org: orgName}});
		const tls_cacerts = path.resolve(cryptoPath.peers(), peer_hostName_full, 'tls', 'ca.crt');
		peer = peerUtil.new({peerPort, tls_cacerts, peer_hostName_full});
	} else {
		peer = peerUtil.new({peerPort});
	}
	//NOTE append more info
	peer.peerConfig = peerConfig;

	peer.peerConfig.eventHub = {
		port: eventHubPort,
		clientPromise: objects.user.admin.select(orgName, ClientUtil.new()),
	};
	peer.peerConfig.orgName = orgName;
	peer.peerConfig.peerIndex = peerIndex;
	return peer;
};

const ordererConfig = companyConfig.orderer;


/**

 * @param client
 * @param channelName
 * @param isRenew
 */
exports.prepareChannel = (channelName, client, isRenew) => {

	const channelConfig = channelsConfig[channelName];
	channelUtil.nameMatcher(channelName, true);

	if (isRenew) {
		delete client._channels[channelName];
	} else {
		if (client._channels[channelName]) return client._channels[channelName];
	}

	const channel = client.newChannel(channelName);//NOTE throw exception if exist
	const newOrderer = (ordererName, domain, ordererSingleConfig) => {

		const ordererPort = ordererSingleConfig.portHost;
		if (companyConfig.TLS) {
			const orderer_hostName_full = `${ordererName}.${domain}`;
			const tls_cacerts = path.resolve(CRYPTO_CONFIG_DIR,
				'ordererOrganizations', domain, 'orderers', orderer_hostName_full, 'tls', 'ca.crt');
			return OrdererUtil.new({
				ordererPort,
				tls_cacerts,
				orderer_hostName_full
			});
		} else {
			return OrdererUtil.new({ordererPort});
		}

	};
	if (ordererConfig.type === 'kafka') {
		for (const ordererOrgName in ordererConfig.kafka.orgs) {
			const ordererOrgConfig = ordererConfig.kafka.orgs[ordererOrgName];
			for (const ordererName in ordererOrgConfig.orderers) {
				const ordererSingleConfig = ordererOrgConfig.orderers[ordererName];
				const orderer = newOrderer(ordererName, ordererOrgName, ordererSingleConfig);
				channel.addOrderer(orderer);
			}

		}
	} else {

		const orderer = newOrderer(ordererConfig.solo.container_name, ordererConfig.solo.orgName, ordererConfig.solo);
		channel.addOrderer(orderer);
	}

	for (const orgName in channelConfig.orgs) {
		const orgConfigInChannel = channelConfig.orgs[orgName];
		for (const peerIndex of orgConfigInChannel.peerIndexes) {
			const peerConfig = orgsConfig[orgName].peers[peerIndex];

			const peer = preparePeer(orgName, peerIndex, peerConfig);
			channel.addPeer(peer);

		}
	}
	channel.eventWaitTime = channelsConfig[channelName].eventWaitTime;
	channel.orgs = channelsConfig[channelName].orgs;
	return channel;
};

const getStateDBCachePath = () => {
//state DB is designed for caching heavy-weight User object,
// client.getUserContext() will first query existence in cache first
	return nodeConfig.stateDBCacheDir;
};

exports.newPeers = (peerIndexes, orgName) => {

// work as a data adapter, containerNames: array --> orgname,peerIndex,peerConfig for each newPeer
	const targets = [];
	// find the peer that match the urls
	for (const index of peerIndexes) {

		const peerConfig = orgsConfig[orgName].peers[index];
		if (!peerConfig) continue;
		const peer = preparePeer(orgName, index, peerConfig);
		targets.push(peer);
	}
	return targets;

};

const bindEventHub = (richPeer, client) => {
	// NOTE newEventHub binds to clientContext, eventhub error { Error: event message must be properly signed by an identity from the same organization as the peer: [failed deserializing event creator: [Expected MSP ID PMMSP, received BUMSP]]

	const eventHubPort = richPeer.peerConfig.eventHub.port;
	const pem = richPeer.pem;
	const peer_hostName_full = richPeer._options['grpc.ssl_target_name_override'];
	return EventHubUtil.new(client, {eventHubPort, pem, peer_hostName_full});

};
/**
 * NOTE just static getter
 * @param orgName
 */
const getMspID = (orgName) => {

	const mspid = orgsConfig[orgName].MSP.id;
	return mspid;
};

const rawAdminUsername = 'Admin';
const objects = {};

objects.user = {
	tlsCreate: (tlsDir, username, orgName, mspid = getMspID(orgName), skipPersistence = false, client) => {
		const privateKey = path.join(tlsDir, 'server.key');
		const signedCert = path.join(tlsDir, 'server.crt');
		const createUserOpt = {
			username: formatUsername(username, orgName),
			mspid,
			cryptoContent: {privateKey, signedCert},
			skipPersistence,
		};
		if (skipPersistence) {
			return client.createUser(createUserOpt);
		} else {
			return sdkUtils.newKeyValueStore({
				path: getStateDBCachePath(orgName),
			}).then((store) => {
				client.setStateStore(store);
				return client.createUser(createUserOpt);
			});
		}
	},
	mspCreate: (client,
				{keystoreDir, signcertFile, username, orgName, mspid = getMspID(orgName), skipPersistence = false}) => {
		const keyFile = pathUtil.findKeyfiles(keystoreDir)[0];
		// NOTE:(jsdoc) This allows applications to use pre-existing crypto materials (private keys and certificates) to construct user objects with signing capabilities
		// NOTE In client.createUser option, two types of cryptoContent is supported:
		// 1. cryptoContent: {		privateKey: keyFilePath,signedCert: certFilePath}
		// 2. cryptoContent: {		privateKeyPEM: keyFileContent,signedCertPEM: certFileContent}

		const createUserOpt = {
			username,
			mspid,
			cryptoContent: {privateKey: keyFile, signedCert: signcertFile},
			skipPersistence,
		};
		if (skipPersistence) {
			return client.createUser(createUserOpt);
		} else {
			return sdkUtils.newKeyValueStore({
				path: getStateDBCachePath(orgName),
			}).then((store) => {
				client.setStateStore(store);
				return client.createUser(createUserOpt);
			});
		}
	},
	/**
	 * search in stateStore first, if not exist, then query state db to get cached user object
	 * @param username
	 * @param orgName
	 * @param client
	 * @return {Promise.<TResult>}
	 */
	get: (username, orgName, client) => {
		const newKVS = () => sdkUtils.newKeyValueStore({
			path: getStateDBCachePath(orgName),
		}).then((store) => {
			client.setStateStore(store);
			return client.getUserContext(formatUsername(username, orgName), true);
		});
		if (client.getStateStore()) {
			return client.loadUserFromStateStore(formatUsername(username, orgName)).then(user => {
				if (user) return user;
				return newKVS();
			});
		} else {
			return newKVS();
		}
	},
	createIfNotExist: (keystoreDir, signcertFile, username, orgName, client) =>
		objects.user.get(username, orgName, client).then(user => {
			if (user) return client.setUserContext(user, false);
			return objects.user.mspCreate(client, {
				keystoreDir, signcertFile,
				username: formatUsername(username, orgName)
				, orgName
			});
		}),
	select: (keystoreDir, signcertFile, username, orgName) => {
		const client = ClientUtil.new();
		return objects.user.createIfNotExist(keystoreDir, signcertFile, username, orgName, client);
	},

};
exports.formatPeerName = (peerName, orgName) => `${peerName}.${orgName}`;
const formatUsername = (username, orgName) => `${username}@${orgName}`;
objects.user.admin = {
	orderer: {
		select: (ordererOrg) => {

			const cryptoPath = new CryptoPath(CRYPTO_CONFIG_DIR, {
				orderer: {
					org: ordererOrg
				},
				user: {
					name: rawAdminUsername
				}
			});
			const keystoreDir = path.resolve(cryptoPath.ordererUserMSP(), 'keystore');
			const signcertFile = path.resolve(cryptoPath.ordererUserMSPSigncert());
			let ordererOrgConfig;
			if (ordererConfig.type === 'kafka') {
				ordererOrgConfig = ordererConfig.kafka.orgs[ordererOrg];
			} else {
				ordererOrgConfig = ordererConfig.solo;
			}
			const ordererMSPID = ordererOrgConfig.MSP.id;
			const client = ClientUtil.new();

			return objects.user.mspCreate(client, {
				keystoreDir, signcertFile,
				username: rawAdminUsername,
				orgName: ordererOrg,
				mspid: ordererMSPID,
			}).then(() => Promise.resolve(client));

		},
	}
	,
	get: (orgName, client) => objects.user.get(rawAdminUsername, orgName, client),
	create: (orgName, client) => {

		const org_domain = `${orgName}`;


		const admin_name_full = `${rawAdminUsername}@${org_domain}`;
		const keystoreDir = path.join(CRYPTO_CONFIG_DIR, 'peerOrganizations', org_domain, 'users', admin_name_full,
			'msp', 'keystore');

		const signcertFile = path.join(CRYPTO_CONFIG_DIR,
			'peerOrganizations', org_domain, 'users', admin_name_full, 'msp', 'signcerts',
			`${admin_name_full}-cert.pem`);

		return objects.user.mspCreate(client, {
			keystoreDir, signcertFile,
			username: formatUsername(rawAdminUsername, orgName),
			orgName
		});
	},
	createIfNotExist: (orgName, client) => objects.user.admin.get(orgName, client).then(user => {
		if (user) return client.setUserContext(user, false);
		return objects.user.admin.create(orgName, client);
	}),
	select: (orgName) => {
		const client = ClientUtil.new();
		return objects.user.admin.createIfNotExist(orgName, client).then(() => Promise.resolve(client));
	},
};



exports.globalConfig = globalConfig;
exports.preparePeer = preparePeer;
exports.userAction = objects.user;
exports.bindEventHub = bindEventHub;
exports.getOrgAdmin = objects.user.admin.select;
exports.formatUsername = formatUsername;