const helper = require('./helper')

const globalConfig = require('../config/orgs.json')
const caUtil = require('./util/ca')
const setCAAdmin = (client, { COMPANY = 'delphi', orgName, TLS }, caService = getCaService({ orgName, TLS })) => {
	const companyConfig = globalConfig[COMPANY]
	const orgsConfig = companyConfig.orgs
	const caConfig = orgsConfig[orgName].ca

	//this admin is not generated by cryptogen
	const CAadminName = caConfig.admin.name
	const CAadminPass = caConfig.admin.pass

	const MSPID = orgsConfig[orgName].MSP.id
	return caUtil.enroll(caService, { enrollmentID: CAadminName, enrollmentSecret: CAadminPass }).
			then((result) => {
				return caUtil.user.build(helper.formatUsername(CAadminName, orgName), result, MSPID).then((user) => {
					return client.setUserContext(user, true)
				})
			})
}

const getCaService = ({ orgName, COMPANY = 'delphi', TLS }) => {
	const orgConfig = globalConfig[COMPANY].orgs[orgName]
	const ca_port = TLS ? orgConfig.ca.tlsca.portHost : orgConfig.ca.portHost
	const caHost = 'localhost'
	const caProtocol = TLS ? 'https://' : 'http://'

	const caUrl = `${caProtocol}${caHost}:${ca_port}`
	// const org_domain=`${orgName}.${COMPANY_DOMAIN}`
	// const tlscaCert=path.join(CRYPTO_CONFIG_DIR,'peerOrganizations',org_domain,'tlsca',`tlsca.${org_domain}-cert.pem`)
	// const trustedRoots=[fs.readFileSync(tlscaCert).toString()] //fixme  Error: Calling register endpoint failed with error [Error: Hostname/IP doesn't match certificate's altnames: "Host: localhost. is not cert's CN: tlsca.BU.Delphi.com"]
	return caUtil.new(caUrl)
}
exports.getCaService = getCaService

exports.setCAAdmin = setCAAdmin