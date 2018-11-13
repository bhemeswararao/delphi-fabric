/**
 *  @typedef {Object} PeerQueryRequest
 * @property {Peer | string} target - The {@link Peer} object or peer name to
 *           use for the service discovery request
 * @property {boolean} useAdmin - Optional. Indicates that the admin credentials
 *           should be used in making this call to the peer. An administrative
 *           identity must have been loaded by a connection profile or by
 *           using the 'setAdminSigningIdentity' method.
 */
const helper = require('./helper');
const logger = require('../common/nodejs/logger').new('test:serviceDiscovery', true);
const {pretty} = require('../common/nodejs/serviceDiscovery');
const task = async () => {
	const org = 'icdd';
	const client = await helper.getOrgAdmin(org, 'peer');
	const peer = helper.newPeers([0], org)[0];
	const discoveries = await client.queryPeers({target: peer, useAdmin: false});
	logger.debug(pretty(discoveries));
};
task();
