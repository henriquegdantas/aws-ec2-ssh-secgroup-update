#!/usr/bin/env node

var fs = require('fs-extra');
var program = require('commander');
var osenv = require('osenv');
var http = require('http');
var async = require('async');
var AWS = require('aws-sdk');

// Establish region and security group from command line

program
  .option('-r, --region [region]', 'AWS region', 'us-east-1')
  .option('-s, --secgroup [secgroup]', 'Security group', '')
  .option('-f, --force', 'Force update')
  .parse(process.argv);

// Ensure we have a security group supplied

if (program.secgroup === '') {
   console.error('No security group given!');
   process.exit(1);
}

console.log('Region: %s', program.region);
console.log('Security Group: %s', program.secgroup);

// Setup AWS API version and region

AWS.config.apiVersions = {
  ec2: '2015-10-01',
};

AWS.config.update({
  region: program.region
});

// Setup and determine some variables

var ipaddress_old;
var ipaddress_new;
var homedir = osenv.home();

// Get to work

async.series([
  // get our external IP
  function (callback) {
    http.get({'host': 'api.ipify.org', 'port': 80, 'path': '/'}, function (resp) {
      resp.on('data', function (ip) {
        ipaddress_new = ip;
        return callback();
      });
    });
  },

  // first we check for existing file and make a backup if needed
  function (callback) {
    fs.exists(homedir + '/.amazonip', function (fileExists) {
      if (fileExists) {
        ipaddress_old = fs.readFileSync(homedir + '/.amazonip', 'utf8');
        fs.copySync(homedir + '/.amazonip', homedir + '/.amazonip.old');
      }
      return callback();
    });
  },

  // write new IP to our file
  function (callback) {
    fs.writeFile(homedir + '/.amazonip', ipaddress_new, function (err) {
      if (err) {
        return callback(err);  
      }
      return callback();  
    });
  },

  // compare old and new IPs and if they are the same and we aren't forcing update we can exit
  function (callback) {
    if (typeof ipaddress_old !== undefined && ipaddress_old.toString() === ipaddress_new.toString() && !program.force) {
      console.log('No update required');
      process.exit(0);
    } else {
      return callback();
    }
  },

  // remove old IP from security group
  function (callback) {
    var ec2 = new AWS.EC2();
    var params = {
      CidrIp: ipaddress_old + '/32',
      DryRun: false,
      FromPort: 22,
      GroupId: program.secgroup,
      IpProtocol: 'TCP',
      ToPort: 22
    };

    ec2.revokeSecurityGroupIngress(params, function(err, data) {
      if (err) {
        console.log('Error removing old IP address from security group');
        console.log(err, err.stack);
      }
      return callback();
    });
  },

  // add new IP
  function (callback) {
    var ec2 = new AWS.EC2();
    var params = {
      CidrIp: ipaddress_new + '/32',
      DryRun: false,
      FromPort: 22,
      GroupId: program.secgroup,
      IpProtocol: 'TCP',
      ToPort: 22
    };

    ec2.authorizeSecurityGroupIngress(params, function(err, data) {
      if (err) {
        console.log('Error adding new IP address from security group');
        return callback(err);
      }
      return callback();
    });
  }
],

function (err, results) {
  if (err) {
    console.log('Error: ' + JSON.stringify(err));
  } else {
    console.log('IP address updated');
  }
  process.exit(0);
});
