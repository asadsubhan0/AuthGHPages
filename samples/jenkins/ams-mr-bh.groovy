//Black Hole
import hudson.model.User
import hudson.tasks.Mailer

/*
 * Created a global variables to hold all the IDs allowed to input
 */

pipeline {
	agent{
		label 'automs'
	}
 
    stages {
		stage(' Build Details '){
			steps{
				script{
					buildDescription "Release: ${params.releaseVersion}" + "\n MS: ${params.MSName}"
				}
			}
		}
			
		stage('Scrum Master prepared secret holder?'){
			steps{
				script{
					ansiColor('xterm') {
						def secretTBCollected = ""
						
						ArrayList listOfSecrets = params.secretsNeedsInput.replaceAll("\\[","").replaceAll("]","").split(",")
						
						println("\u001B[1m\u001B[36m" + "***** Following Secrets are Pending for " + params.MSName + " MS : \n")
						

						for(String ele : listOfSecrets){
							if(! (ele.trim().equals("app-config.secret-encryption.encryption-key")) || ( ele.trim().equals("app.key-store-password") && (buildEnvironment == "hodc" || buildEnvironment == "pcdc")) ){
								//print(ele.trim());
								secretTBCollected = secretTBCollected + '\n' + ele.trim()
							}
						}
						
						println( "\u001B[39m\u001B[22m" )
						
						input  message: 'Ready to collect the below secrets for ' + params.MSName + " in release " + params.releaseVersion +  ' ?\n' + '\n' + secretTBCollected,
							ok: 'Let\'s Go!',
							submitter: '007431,919902,917664,921816,921119,921819',
							submitterParameter: 'Processed_By'
					}
				}
			}
		}
			
		stage('Give me the meter'){
			steps{
				script{
					collectSecretsFromUsers(params.secretsNeedsInput , params.MSName, params.BUILD_ENV);
				}
			}
		}	
			
		stage('Update the deployment config file'){
			steps{
				script{
				buildEnvironment = params.BUILD_ENV.toLowerCase()
		if(!(params.secretsNeedsInput.isEmpty())){
			if(!(buildEnvironment.equals("uat") || (buildEnvironment == "hodc" || buildEnvironment == "pcdc"))){

				build job: 'MicroServices/dts-ams/ams-pre-sit-dc', 
								parameters: [
								[$class: 'StringParameterValue', name: 'NODE_NAME', value: params.NODE_NAME],
								[$class: 'StringParameterValue',name: 'APPLICATION_NAMESPACE', value: params.APPLICATION_NAMESPACE],
								[$class: 'StringParameterValue', name: 'MSName', value: params.MSName],
								[$class: 'StringParameterValue', name: 'UPSTREAM_WORKSPACE', value: params.UPSTREAM_WORKSPACE],
								[$class: 'StringParameterValue', name: 'BUILD_ENV', value: buildEnvironment],
								[$class: 'StringParameterValue', name: 'imageTagDetails', value: params.imageTagDetails]],
								wait: true
						}
					}
				}
			}
		}
	}
}

def collectSecretsFromUsers(secretsNeedsInput , MicroserviceName, buildEnvironment){
	withCredentials([string(credentialsId: 'HashiCorp-vault-Yoko', variable: 'HashiCorp_vault_Yoko')]) {		
		def  jsonOutput = ""
		if ( buildEnvironment == "hodc" || buildEnvironment == "pcdc" ){
			jsonOutput = sh (script: """
				set +x 
					curl -k --location --request GET 'https://azvault.adib.co.ae/v1/prod/data/Microservices-secret-store/AppPro/${buildEnvironment}/${MicroserviceName}' --header 'X-Vault-Token: ${HashiCorp_vault_Yoko}'
				set -x
				""", returnStdout: true).trim()

			}else{
			jsonOutput = sh (script: """
				set +x 
					curl -k --location --request GET 'https://azvault.adib.co.ae/v1/kv/data/Microservices-secret-store/AppPro/${buildEnvironment}/${MicroserviceName}' --header 'X-Vault-Token: ${HashiCorp_vault_Yoko}'
				set -x
				""", returnStdout: true).trim()
				}
		def	HCkey , requiredKey , encKeyVal = ""
		def entries = readJSON text: jsonOutput
		ArrayList listOfSecrets = secretsNeedsInput.replaceAll("\\[","").replaceAll("]","").split(",")
		
		// echo "entries are ---------- : " + entries
		if (listOfSecrets.contains("app.key-store-password") && (buildEnvironment == "hodc" || buildEnvironment == "pcdc")) {
			def filteredSecrets = listOfSecrets.findAll { it.trim() != "app.key-store-password" }
			echo "The list of secrets: " + filteredSecrets
		} else {
			echo "The list of secrets: " + listOfSecrets
		}
		
		for(String ele : listOfSecrets){
			def newItem = true
			requiredKey = ele.trim()
			encKeyVal = getAbsoluteEncKey(entries)

			entries.data.data.eachWithIndex{isit,index ->
				HCkey = isit.getKey().trim()

				if(requiredKey.equals(HCkey)){
					entries.data.data.replace(requiredKey , resurrectZombie( "007431,919902,917664,921816,921119,921819,920333,921816", HCkey, MicroserviceName, buildEnvironment , encKeyVal ).toString().trim() )
					newItem = false
				}else{
					if(index == entries.data.data.size()-1 && newItem){
						entries.data.data.put(requiredKey , resurrectZombie( "007431,919902,917664,921816,921119,921819,920333,921816", HCkey, MicroserviceName, buildEnvironment , encKeyVal ).toString().trim() )
					}
				}
			}
		}
		
        //println("What do you want to Add ?? ..  " + entries)

		addToHashi(entries , MicroserviceName, buildEnvironment);
	}
}
def getAbsoluteEncKey(entries){
	def encKeyVal = "9c843a91d57b1c37f6ce98d66045bf90"
	entries.data.data.each { key, value ->
		if(key.trim().equals("app-config.secret-encryption.encryption-key")){
			encKeyVal = value.trim()
			if(encKeyVal.equals("TBD")){
				encKeyVal = encWithHash(params.APPLICATION_NAMESPACE)
			}
		}
	}
	return encKeyVal
}

def encWithHash(APPLICATION_NAMESPACE){
	def generatedSha = sh( script: """
			set +x
				echo "${APPLICATION_NAMESPACE}" | sha1sum -t
			set -x
		""", returnStdout: true).trim()

	encKeyVal = generatedSha.substring( 0, 32 )
	return encKeyVal


}

def encKSPWDWithHash(APPLICATION_NAMESPACE ){
	def generatedSha = sh( script: """
			set +x
				echo "${APPLICATION_NAMESPACE}-jks" | sha1sum -t
			set -x
		""", returnStdout: true).trim()

	encKeyVal = generatedSha.substring( 0, 32 )
	return encKeyVal
}

def resurrectZombie(id, secret, MicroserviceName, buildEnvironment, encKeyVal) {
	ansiColor('xterm') {
		def inputTxt = ""

		if (secret.equals("app.key-store-password") && (buildEnvironment == "hodc" || buildEnvironment == "pcdc")) {
			inputTxt = encKSPWDWithHash(params.APPLICATION_NAMESPACE)
		} else if (secret.equals("app-config.secret-encryption.encryption-key")) {
			inputTxt = encKeyVal
		} else {
			println("\u001B[1m\u001B[34m" + " Please Enter the value of " + secret + " in " + MicroserviceName + " Microservice *****")
			inputTxt = input(
				message: 'Please enter the secret for ' + secret + " in " + MicroserviceName,
				ok: 'Submit',
				parameters: [password(defaultValue: 'asd123', description: 'Please enter your secret', name: 'Secret')],
				submitter: id
			)
		}

		println("\u001B[39m\u001B[22m")

		// Check the list if the key value has to be encrypted
		if (params.listOfKeysToBeEncrypted.contains(secret)) {
			echo "\033[31m" + secret + " is in the list (" + params.listOfKeysToBeEncrypted + ")\033[0m"
			// echo "What we got is " + inputTxt + " and the ENC is " + encKeyVal
			// Encrypt the value if the key is in the list
			inputTxt = sh(
				script: """
					set +x
						cd /data
						jdk-11.0.2/bin/java encrypt.Encrypt "${encKeyVal}" ${inputTxt}
					set -x
				""",
				returnStdout: true
			).trim()
		}

		return inputTxt
	}
}

def encryptTheSecret(PlainSecret){
	wrap([$class: "MaskPasswordsBuildWrapper", varPasswordPairs: [[password: PlainSecret.toString()]]]) {
		withCredentials([usernamePassword(credentialsId: 'GradleEncI', passwordVariable: 'jasyptPwd', usernameVariable: 'jasyptAlgo')]) {
			def outEnc = sh (script: """
				set +x 
					/home/DevOpsAdm/Software/jasypt-1.9.2/bin/automsenc.sh input='${PlainSecret}' password=${jasyptPwd} algorithm=${jasyptAlgo} verbose=false
				set -x
				""", returnStdout: true).trim()
			return	"ENC(" + outEnc + ")"
		}
	}
}

def addToHashi(entries , MicroserviceName, buildEnvironment){
	//println("----------- ADded ? " + entries)
	jsonBody = returnJson(entries.data.toString());
	if (buildEnvironment == "hodc" || buildEnvironment == "pcdc" ){
		
		sh"""
			set +x 
				curl -k --location --request POST 'https://azvault.adib.co.ae/v1/prod/data/Microservices-secret-store/AppPro/${buildEnvironment}/${MicroserviceName}' --header 'X-Vault-Token: ${HashiCorp_vault_Yoko}' --header 'Content-Type: text/plain' --data '${jsonBody}'
			set -x 
		"""
		
		}else{
	
		sh"""
			set +x 
				curl -k --location --request POST 'https://azvault.adib.co.ae/v1/kv/data/Microservices-secret-store/AppPro/${buildEnvironment}/${MicroserviceName}' --header 'X-Vault-Token: ${HashiCorp_vault_Yoko}' --header 'Content-Type: text/plain' --data '${jsonBody}'
			set -x 
		"""

			
		}

	//println("----------- How about now ADded ? " + entries)
}

@NonCPS
def returnJson(list){
	
		def slurper = new groovy.json.JsonSlurperClassic()
		def result = slurper.parseText(list)

	return groovy.json.JsonOutput.toJson(result)
}