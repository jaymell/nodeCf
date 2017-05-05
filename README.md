## Overview
Simple package to help with Cloudformation deployments

### Goals
* Make it easy to deploy multi-stack Cloudformation templates
* Encourage multi-environment deployments
* Promote use of 'native' Cloudformation templates (i.e., with minimal pre-processing)

### Usage
node_modules/.bin/nodeCf \<Environment Name\> [ -r \<region\> ] [ -p \<profile\> ]

### TO DO
* Print progress of deployments
* Use change sets
* Make it easy to set stack update policies
* Delete files from s3 after deployments?
* Add more unit tests
* Fix bugs
