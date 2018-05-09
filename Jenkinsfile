pipeline {
    agent {
		docker { image 'node:latest' }
    }

    stages {
        stage('Build') {
            steps {
                sh 'npm install'
                sh 'npm run lint'
                sh 'npm run test'
            }
        }
        stage('Test') {
            steps {
              sh 'npm run integration'
            }
        }
    }
}
