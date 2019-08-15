const globalConfig = require('../../config/orgs');
const {TLS, docker: {fabricTag, network, volumes: {MSPROOT: mspDir}}, orderer: {type: OrdererType, genesis_block: {file: BLOCK_FILE}}} = globalConfig;
const protocol = TLS ? 'https' : 'http';
const helper = require('../../app/helper');
const logger = helper.getLogger('test:add local orderer');
const {CryptoPath} = require('../../common/nodejs/path');
const {genOrderer, init} = require('../../common/nodejs/ca-crypto-gen');
const caUtil = require('../../common/nodejs/ca');
const {nodeUtil, dockerode} = require('../../common/nodejs/helper');
const {inflateContainerName, containerDelete, containerStart} = dockerode.util;
const {swarmServiceName} = dockerode.swarmUtil;
const dockerCmd = dockerode.cmd;
const {runOrderer, runCA} = require('../../common/nodejs/fabric-dockerode');
const {RequestPromise} = require('khala-nodeutils/request');
const {fsExtra, sleep, homeResolve} = nodeUtil.helper();
const peerUtil = require('../../common/nodejs/peer');

const caCryptoConfig = homeResolve(mspDir);
const {port: swarmServerPort} = require('../../swarm/swarm.json').swarmServer;
const fs = require('fs');

const nodeType = 'orderer';
const imageTag = `${fabricTag}`;
const getCaService = async (url, domain, swarm) => {
	if (TLS) {
		const caHostName = `ca.${domain}`;
		let container_name;
		if (swarm) {
			const serviceName = swarmServiceName(caHostName);
			container_name = (await inflateContainerName(serviceName))[0];
			if (!container_name) {
				throw Error(`service ${serviceName} not assigned to current node`);
			}
		} else {
			container_name = caHostName;
		}
		const from = caUtil.container.caCert;
		const to = `${caHostName}-cert.pem`;
		await dockerCmd.copy(container_name, from, to);

		const pem = fs.readFileSync(to);
		return caUtil.new(url, [pem]);
	}
	return caUtil.new(url);
};

const ordererName = 'orderer3';
const channelName = 'allchannel';
const serverClient = require('../../swarm/serverClient');
const runWithNewOrg = async (action) => {
	const orgName = 'NewConsensus.delphi';
	const mspName = 'NewConsensus';
	const mspid = 'NewConsensusMSP';
	const caContainerName = `ca.${orgName}`;
	const port = 9054;
	const hostCryptoPath = new CryptoPath(caCryptoConfig, {
		orderer: {
			org: orgName, name: ordererName
		},
		password: 'passwd',
		user: {
			name: 'Admin'
		}
	});
	if (action === 'down') {
		await containerDelete(caContainerName);
		await run(orgName, undefined, undefined, action, mspid);
		fsExtra.emptyDirSync(hostCryptoPath.ordererOrg());
		return;
	}
	const Issuer = {CN: orgName};
	await runCA({container_name: caContainerName, port, network, imageTag, TLS, Issuer});

	const caUrl = `${protocol}://localhost:${port}`;
	const caService = await getCaService(caUrl, orgName, false);

	await sleep(2000);

	const admin = await init(caService, hostCryptoPath, nodeType, mspid, {TLS});

	const {msp: {admincerts, cacerts, tlscacerts}} = hostCryptoPath.OrgFile(nodeType);


	const baseUrl = `http://localhost:${swarmServerPort}`;
	await serverClient.createOrUpdateOrg(baseUrl, channelName, mspid, mspName, nodeType, {
		admins: [admincerts],
		root_certs: [cacerts],
		tls_root_certs: [tlscacerts]
	}, false);

	const container_name = hostCryptoPath.ordererHostName;
	if (action === 'down') {
		await containerDelete(container_name);
		return;
	}


	// ///////update address
	const ordererAdress = `${hostCryptoPath.ordererHostName}:7050`;


	const url = `http://localhost:${swarmServerPort}/channel/newOrderer`;


	try {
		await RequestPromise({url, body: {address: ordererAdress}});

		await genOrderer(caService, hostCryptoPath, admin, {TLS});


		const {MSPROOT} = peerUtil.container;

		const cryptoPath = new CryptoPath(MSPROOT, {
			orderer: {
				org: orgName, name: ordererName
			},
			password: 'passwd',
			user: {
				name: 'Admin'
			}
		});
		const ordererUtil = require('../../common/nodejs/orderer');
		const tls = TLS ? cryptoPath.TLSFile(nodeType) : undefined;
		const configPath = cryptoPath.MSP(nodeType);
		const Image = `hyperledger/fabric-orderer:${imageTag}`;
		const Cmd = ['orderer'];
		const Env = ordererUtil.envBuilder({
			BLOCK_FILE, msp: {
				configPath, id: mspid
			}, OrdererType, tls
		});

		const createOptions = {
			name: container_name,
			Env,
			Volumes: {
				[peerUtil.container.MSPROOT]: {},
				[ordererUtil.container.CONFIGTX]: {},
				[ordererUtil.container.state]: {}
			},
			Cmd,
			Image,
			ExposedPorts: {
				'7050': {}
			},
			Hostconfig: {
				Binds: [
					`MSPROOT:${peerUtil.container.MSPROOT}`,
					`CONFIGTX:${ordererUtil.container.CONFIGTX}`,
					`ledger:${ordererUtil.container.state}`
				],
				PortBindings: {
					'7050': [
						{
							HostPort: '9050'
						}
					]
				}
			},
			NetworkingConfig: {
				EndpointsConfig: {
					[network]: {
						Aliases: [container_name]
					}
				}
			}
		};
		return containerStart(createOptions);

	} catch (e) {
		logger.error(e);
		process.exit(1);
	}

};
const runWithExistOrg = async (action) => {
	const orgName = 'DelphiConsensus.delphi';
	const ordererConfig = globalConfig.orderer.kafka.orgs[orgName];
	const mspid = ordererConfig.mspid;
	const caUrl = `${protocol}://localhost:${ordererConfig.ca.portHost}`;
	const caService = await getCaService(caUrl, orgName, false);
	const adminClient = await helper.getOrgAdmin(orgName, nodeType);
	const admin = adminClient._userContext;
	await run(orgName, caService, admin, action, mspid);
};
/**
 *
 * @param orgName
 * @param caService
 * @param admin
 * @param action
 * @param mspid
 * @returns {Promise<void>}
 */
const run = async (orgName, caService, admin, action, mspid) => {
	const hostCryptoPath = new CryptoPath(caCryptoConfig, {
		orderer: {
			org: orgName, name: ordererName
		},
		password: 'passwd',
		user: {
			name: 'Admin'
		}
	});
	const container_name = hostCryptoPath.ordererHostName;
	if (action === 'down') {
		await containerDelete(container_name);
		return;
	}


	// ///////update address
	const ordererAdress = `${hostCryptoPath.ordererHostName}:7050`;


	const url = `http://localhost:${swarmServerPort}/channel/newOrderer`;


	await RequestPromise({url, body: {address: ordererAdress}});

	await genOrderer(caService, hostCryptoPath, admin, {TLS});


	const {MSPROOT} = peerUtil.container;

	const cryptoPath = new CryptoPath(MSPROOT, {
		orderer: {
			org: orgName, name: ordererName
		},
		password: 'passwd',
		user: {
			name: 'Admin'
		}
	});
	const tls = TLS ? cryptoPath.TLSFile(nodeType) : undefined;
	const configPath = cryptoPath.MSP(nodeType);
	await runOrderer({
		container_name, imageTag,
		port: 9050, network,
		BLOCK_FILE, CONFIGTXVolume: 'CONFIGTX',
		msp: {
			id: mspid,
			configPath,
			volumeName: 'MSPROOT'
		},
		OrdererType,
		tls
	});


};
runWithNewOrg(process.env.action);
