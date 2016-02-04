module.exports = function(mongoose) {
	var Schema = mongoose.Schema;
	var UserSchema = new Schema({
		id: String,
		name: String
	});
	return mongoose.model('User', UserSchema);
}
