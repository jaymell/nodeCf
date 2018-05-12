pipeline {
    agent {
		docker { image 'node:latest' }
    }

    stages {
            steps {
                sh 'npm install'
                sh 'npm run lint'
                sh 'npm run test'
            }
        }
        stage('Test') {
            steps {
              withCredentials([string(credentialsId: 'infraBucket', variable: 'infraBucket')]) {
              	sh 'npm run integration'
			  }
            }
        }
    }
}
