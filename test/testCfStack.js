var _ = require('lodash');

var output = [
  {"OutputKey": "Key1", "OutputValue": "Value1", "Description": "Desc1"},
  {"OutputKey": "Key2", "OutputValue": "Value2", "Description": "Desc2"},
  {"OutputKey": "Key3", "OutputValue": "Value3" }
];

_.map(output, (it) => _(it).pick(['OutputKey', 'OutputValue']).toPairs().unzip().tail().zipObject().value());


_.chain(output).keyBy('OutputKey').mapValues('OutputValue').value();

